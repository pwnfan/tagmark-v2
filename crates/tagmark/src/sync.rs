use base64::Engine;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;
use tagmark::{Collection, Result};

const LIMIT: u64 = 10 * 1024 * 1024;
const CONFLICT: &str =
    "Sync conflict: local and remote changes are kept; automatic merge is not available yet";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Baseline {
    repository: String,
    branch: String,
    head: String,
    snapshot: Collection,
}

struct Repository {
    client: Client,
    origin: String,
    name: String,
    token: String,
}

impl Repository {
    fn new(name: &str) -> Result<Self> {
        let parts: Vec<_> = name.split('/').collect();
        if parts.len() != 2
            || parts
                .iter()
                .any(|part| part.is_empty() || *part == "." || *part == "..")
            || !parts[0]
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
            || !parts[0].as_bytes()[0].is_ascii_alphanumeric()
            || !parts[1]
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
        {
            return Err("Use a repository in owner/name form".into());
        }
        let token = std::env::var("TAGMARK_GITHUB_TOKEN")
            .map_err(|_| "Set TAGMARK_GITHUB_TOKEN in this process environment")?;
        if token.trim().is_empty() || token.contains(['\r', '\n']) {
            return Err("Invalid TAGMARK_GITHUB_TOKEN".into());
        }
        let mut origin = "https://api.github.com".to_string();
        // Test builds can talk only to an explicitly selected loopback fixture.
        // Release builds have no endpoint override.
        if cfg!(debug_assertions)
            && let Ok(endpoint) = std::env::var("TAGMARK_TEST_API")
        {
            let parsed = url::Url::parse(&endpoint).map_err(|_| "Invalid test API")?;
            if parsed.scheme() != "http"
                || parsed.host_str() != Some("127.0.0.1")
                || parsed.port().is_none()
                || parsed.path() != "/"
                || parsed.query().is_some()
                || parsed.fragment().is_some()
                || !parsed.username().is_empty()
                || parsed.password().is_some()
            {
                return Err("Untrusted repository API origin".into());
            }
            origin = endpoint.trim_end_matches('/').to_string();
        }
        let mut builder = Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("TagMark/0.1");
        if origin.starts_with("http://127.0.0.1:") {
            builder = builder.no_proxy();
        }
        let client = builder
            .build()
            .map_err(|_| "Repository client could not start")?;
        Ok(Self {
            client,
            origin,
            name: name.into(),
            token,
        })
    }
    fn request(
        &self,
        path: &str,
        body: Option<Value>,
        missing: bool,
        raw: bool,
    ) -> Result<Option<Value>> {
        let endpoint = if path == "/graphql" {
            format!("{}{}", self.origin, path)
        } else {
            format!("{}/repos/{}{}", self.origin, self.name, path)
        };
        let mut request = if let Some(body) = body {
            self.client.post(endpoint).json(&body)
        } else {
            self.client.get(endpoint)
        };
        request = request
            .bearer_auth(&self.token)
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header(
                "Accept",
                if raw {
                    "application/vnd.github.raw+json"
                } else {
                    "application/vnd.github+json"
                },
            );
        let response = request
            .send()
            .map_err(|_| "Offline or repository connection failed; local changes are kept")?;
        let status = response.status();
        if status.as_u16() == 404 && missing {
            return Ok(None);
        }
        if status.as_u16() == 409 && missing && path.starts_with("/git/ref/heads/") {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(format!(
                "Repository request failed (HTTP {}); local changes are kept",
                status.as_u16()
            )
            .into());
        }
        let mut bytes = Vec::new();
        response
            .take(LIMIT + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Repository response interrupted; local changes are kept")?;
        if bytes.len() as u64 > LIMIT {
            return Err("Repository snapshot exceeds 10 MiB limit".into());
        }
        Ok(Some(serde_json::from_slice(&bytes).map_err(
            |_| "Invalid repository JSON; local changes are kept",
        )?))
    }
    fn private_branch(&self) -> Result<String> {
        let repo = self
            .request("", None, false, false)?
            .ok_or("Missing repository")?;
        if repo["private"] != true {
            return Err("Sync requires a private repository; nothing was uploaded".into());
        }
        Ok(repo["default_branch"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or("Initialize the private repository with a README before syncing")?
            .into())
    }
    fn read(&self) -> Result<(String, String, Option<Collection>)> {
        let branch = self.private_branch()?;
        let encoded: String = url::form_urlencoded::byte_serialize(branch.as_bytes()).collect();
        let reference = self
            .request(&format!("/git/ref/heads/{encoded}"), None, true, false)?
            .ok_or("Initialize the private repository with a README before syncing")?;
        let head = sha(&reference["object"]["sha"])?;
        let value = self.request(
            &format!("/contents/tagmark/collection.json?ref={head}"),
            None,
            true,
            true,
        )?;
        let snapshot = value
            .map(|value| -> Result<Collection> {
                let collection: Collection = serde_json::from_value(value)
                    .map_err(|_| "Invalid repository snapshot; local changes are kept")?;
                collection
                    .validate()
                    .map_err(|_| "Invalid repository snapshot; local changes are kept")?;
                Ok(collection)
            })
            .transpose()?;
        Ok((branch, head, snapshot))
    }
    fn write(&self, branch: &str, head: &str, snapshot: &Collection) -> Result<String> {
        if self.private_branch()? != branch {
            return Err(CONFLICT.into());
        }
        let content = serde_json::to_vec(&canonical(snapshot)?)?;
        if content.len() as u64 > LIMIT {
            return Err("Repository snapshot exceeds 10 MiB limit".into());
        }
        let response = self.request("/graphql", Some(json!({
            "query": "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }",
            "variables": {"input": {"branch": {"repositoryNameWithOwner": self.name, "branchName": branch},
                "expectedHeadOid": head, "message": {"headline": "Sync TagMark collection"},
                "fileChanges": {"additions": [{"path": "tagmark/collection.json", "contents": base64::engine::general_purpose::STANDARD.encode(content)}]}}}
        })), false, false)?.ok_or("Missing commit result")?;
        if response
            .get("errors")
            .is_some_and(|errors| !errors.as_array().is_some_and(Vec::is_empty))
        {
            return Err(
                "Sync failed or repository version conflict; local changes are kept".into(),
            );
        }
        sha(&response["data"]["createCommitOnBranch"]["commit"]["oid"])
    }
}

fn sha(value: &Value) -> Result<String> {
    let sha = value.as_str().ok_or("Invalid repository version")?;
    if sha.len() != 40
        || !sha
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err("Invalid repository version".into());
    }
    Ok(sha.into())
}
fn canonical(collection: &Collection) -> Result<Value> {
    let mut copy = collection.clone();
    copy.bookmarks.sort_by(|a, b| a.id.cmp(&b.id));
    copy.tags.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(serde_json::to_value(copy)?)
}

pub fn sync(path: &Path, local: &Collection, name: &str) -> Result<()> {
    let repository = Repository::new(name)?;
    let original_bytes = std::fs::read(path)?;
    let mut state_path = path.as_os_str().to_os_string();
    state_path.push(".sync.json");
    let state_path = std::path::PathBuf::from(state_path);
    let baseline: Option<Baseline> = match std::fs::read(&state_path) {
        Ok(bytes) => {
            Some(serde_json::from_slice(&bytes).map_err(|_| "Invalid local sync baseline")?)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    eprintln!("Syncing private collection…");
    let (branch, mut head, remote) = repository.read()?;
    let baseline = baseline.filter(|state| state.repository.eq_ignore_ascii_case(name));
    if baseline
        .as_ref()
        .is_some_and(|state| state.branch != branch)
    {
        return Err(
            "Sync conflict: default branch changed; local changes and sync baseline are kept"
                .into(),
        );
    }
    let local_value = canonical(local)?;
    let result = if remote.as_ref().map(canonical).transpose()?.as_ref() == Some(&local_value) {
        local.clone()
    } else if let Some(remote) = remote {
        if baseline.as_ref().is_some_and(|state| state.head == head) {
            head = repository.write(&branch, &head, local)?;
            local.clone()
        } else if baseline
            .as_ref()
            .map(|state| canonical(&state.snapshot))
            .transpose()?
            .as_ref()
            == Some(&local_value)
            || (baseline.is_none() && local_value == canonical(&Collection::default())?)
        {
            remote
        } else {
            return Err(CONFLICT.into());
        }
    } else if baseline.is_none() {
        head = repository.write(&branch, &head, local)?;
        local.clone()
    } else {
        return Err(CONFLICT.into());
    };
    // The CLI lock prevents other TagMark commands from editing during requests.
    // Also detect external file editors before replacing their bytes.
    if std::fs::read(path)? != original_bytes {
        return Err("Local collection changed during sync; changes are kept".into());
    }
    if canonical(&result)? != local_value {
        super::write_collection(path, &result, false)?;
    }
    let state = Baseline {
        repository: name.into(),
        branch,
        head: head.clone(),
        snapshot: result,
    };
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer(&mut temporary, &state)?;
    temporary.flush()?;
    temporary.as_file().sync_all()?;
    temporary.persist(state_path)?;
    println!("{}", json!({"status": "success", "head": head}));
    Ok(())
}
