use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::error::Error;
use url::Url;
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, Box<dyn Error>>;
const MAX_MANUAL_VERSION: u64 = 9_007_199_254_740_991;

fn is_blank_definition(value: &str) -> bool {
    value
        .chars()
        .all(|character| character.is_whitespace() || character == '\u{feff}')
}

fn next_manual_version(current: Option<u64>) -> Result<u64> {
    if current.is_some_and(|version| version == 0 || version >= MAX_MANUAL_VERSION) {
        return Err("Manual version cannot be advanced safely".into());
    }
    Ok(current.unwrap_or(0) + 1)
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManualFieldState {
    pub source: ManualSource,
    pub version: u64,
    pub protected: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ManualSource {
    Manual,
}

impl Default for ManualFieldState {
    fn default() -> Self {
        Self {
            source: ManualSource::Manual,
            version: 1,
            protected: true,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaggingRules {
    pub inclusion: String,
    pub exclusion: String,
    pub examples: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Tag {
    pub id: String,
    pub canonical_name: String,
    pub definition: String,
    pub rules: TaggingRules,
    pub field_state: BTreeMap<String, ManualFieldState>,
}

pub fn canonical_tag_name(input: &str) -> Result<String> {
    let name = input
        .trim_matches(|character: char| character.is_ascii_whitespace())
        .to_ascii_lowercase();
    if !name.bytes().any(|byte| byte.is_ascii_alphabetic())
        || !name.bytes().all(|byte| (32..=126).contains(&byte))
    {
        return Err("Use an English canonical name containing a letter".into());
    }
    Ok(name)
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bookmark {
    pub id: String,
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub tag_assignments: BTreeMap<String, TagAssignment>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AssignmentState {
    Added,
    Rejected,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TagAssignment {
    pub state: AssignmentState,
    pub source: ManualSource,
    pub version: u64,
    pub protected: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Collection {
    pub schema_version: u32,
    pub bookmarks: Vec<Bookmark>,
    #[serde(default)]
    pub tags: Vec<Tag>,
}

#[derive(Debug, Serialize)]
pub struct SaveResult {
    pub bookmark: Bookmark,
    pub created: bool,
}

impl Default for Collection {
    fn default() -> Self {
        Self {
            schema_version: 1,
            bookmarks: Vec::new(),
            tags: Vec::new(),
        }
    }
}

impl Collection {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1 {
            return Err(format!("Unsupported schema version: {}", self.schema_version).into());
        }
        let mut ids = HashSet::new();
        let mut urls = HashSet::new();
        for bookmark in &self.bookmarks {
            if Uuid::parse_str(&bookmark.id)?.to_string() != bookmark.id {
                return Err("Bookmark IDs must be canonical UUIDs".into());
            }
            if normalized_url(&bookmark.url)? != bookmark.url {
                return Err("Bookmark URLs must use their normalized form".into());
            }
            if !ids.insert(&bookmark.id) || !urls.insert(&bookmark.url) {
                return Err("Bookmark IDs and URLs must be unique".into());
            }
        }
        let mut tag_ids = HashSet::new();
        let mut names = HashSet::new();
        for tag in &self.tags {
            if Uuid::parse_str(&tag.id)?.to_string() != tag.id {
                return Err("Tag IDs must be canonical UUIDs".into());
            }
            if canonical_tag_name(&tag.canonical_name)? != tag.canonical_name
                || is_blank_definition(&tag.definition)
            {
                return Err(
                    "Tags need a normalized English canonical name and a short definition".into(),
                );
            }
            if !tag_ids.insert(&tag.id) || !names.insert(&tag.canonical_name) {
                return Err("Tag IDs and canonical names must be unique".into());
            }
            for (field, state) in &tag.field_state {
                if ![
                    "canonicalName",
                    "definition",
                    "rules.inclusion",
                    "rules.exclusion",
                    "rules.examples",
                ]
                .contains(&field.as_str())
                    || state.version == 0
                    || state.version > MAX_MANUAL_VERSION
                {
                    return Err("Invalid tag field protection".into());
                }
            }
        }
        for bookmark in &self.bookmarks {
            for (tag_id, assignment) in &bookmark.tag_assignments {
                if !tag_ids.contains(tag_id)
                    || assignment.version == 0
                    || assignment.version > MAX_MANUAL_VERSION
                {
                    return Err("Invalid tag assignment reference or version".into());
                }
            }
        }
        Ok(())
    }

    pub fn create_tag(
        &mut self,
        name: &str,
        definition: &str,
        inclusion: Option<&str>,
        exclusion: Option<&str>,
        examples: Option<&str>,
    ) -> Result<Tag> {
        let canonical_name = canonical_tag_name(name)?;
        if self
            .tags
            .iter()
            .any(|tag| tag.canonical_name == canonical_name)
        {
            return Err(format!("Tag '{canonical_name}' already exists").into());
        }
        if is_blank_definition(definition) {
            return Err("A short English definition is required".into());
        }
        let mut field_state = BTreeMap::new();
        field_state.insert("canonicalName".into(), ManualFieldState::default());
        field_state.insert("definition".into(), ManualFieldState::default());
        for (field, value) in [
            ("rules.inclusion", inclusion),
            ("rules.exclusion", exclusion),
            ("rules.examples", examples),
        ] {
            if value.is_some() {
                field_state.insert(field.into(), ManualFieldState::default());
            }
        }
        let tag = Tag {
            id: Uuid::new_v4().to_string(),
            canonical_name,
            definition: definition.into(),
            rules: TaggingRules {
                inclusion: inclusion.unwrap_or_default().into(),
                exclusion: exclusion.unwrap_or_default().into(),
                examples: examples.unwrap_or_default().into(),
            },
            field_state,
        };
        self.tags.push(tag.clone());
        self.tags.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(tag)
    }

    pub fn edit_tag(
        &mut self,
        id: &str,
        definition: Option<&str>,
        inclusion: Option<&str>,
        exclusion: Option<&str>,
        examples: Option<&str>,
    ) -> Result<Tag> {
        if definition.is_some_and(is_blank_definition) {
            return Err("A short English definition is required".into());
        }
        let original = self
            .tags
            .iter_mut()
            .find(|tag| tag.id == id)
            .ok_or("Tag not found")?;
        let mut tag = original.clone();
        for (field, current, value) in [
            ("definition", &mut tag.definition, definition),
            ("rules.inclusion", &mut tag.rules.inclusion, inclusion),
            ("rules.exclusion", &mut tag.rules.exclusion, exclusion),
            ("rules.examples", &mut tag.rules.examples, examples),
        ] {
            if let Some(value) = value.filter(|value| *value != current) {
                *current = value.into();
                let version =
                    next_manual_version(tag.field_state.get(field).map(|state| state.version))?;
                tag.field_state.insert(
                    field.into(),
                    ManualFieldState {
                        version,
                        ..Default::default()
                    },
                );
            }
        }
        *original = tag.clone();
        Ok(tag)
    }

    pub fn assign_tag(
        &mut self,
        bookmark_id: &str,
        tag_id: &str,
        state: AssignmentState,
    ) -> Result<Bookmark> {
        if !self.tags.iter().any(|tag| tag.id == tag_id) {
            return Err("Tag not found".into());
        }
        let bookmark = self
            .bookmarks
            .iter_mut()
            .find(|bookmark| bookmark.id == bookmark_id)
            .ok_or("Bookmark not found")?;
        let existing = bookmark.tag_assignments.get(tag_id);
        if !existing.is_some_and(|assignment| assignment.state == state && assignment.protected) {
            let version = next_manual_version(existing.map(|assignment| assignment.version))?;
            bookmark.tag_assignments.insert(
                tag_id.into(),
                TagAssignment {
                    state,
                    source: ManualSource::Manual,
                    version,
                    protected: true,
                },
            );
        }
        Ok(bookmark.clone())
    }

    pub fn save(&mut self, input_url: &str, title: &str) -> Result<SaveResult> {
        let url = normalized_url(input_url)?;
        if let Some(bookmark) = self.bookmarks.iter().find(|bookmark| bookmark.url == url) {
            return Ok(SaveResult {
                bookmark: bookmark.clone(),
                created: false,
            });
        }
        let bookmark = Bookmark {
            tag_assignments: BTreeMap::new(),
            id: Uuid::new_v4().to_string(),
            title: if title.trim().is_empty() {
                url.clone()
            } else {
                title.to_string()
            },
            url,
        };
        self.bookmarks.push(bookmark.clone());
        self.bookmarks.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(SaveResult {
            bookmark,
            created: true,
        })
    }
}

fn normalized_url(input: &str) -> Result<String> {
    let parsed = Url::parse(input)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only HTTP(S) URLs can be saved".into());
    }
    Ok(parsed.to_string())
}
