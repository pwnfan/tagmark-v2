use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::error::Error;
use url::Url;
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bookmark {
    pub id: String,
    pub url: String,
    pub title: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Collection {
    pub schema_version: u32,
    pub bookmarks: Vec<Bookmark>,
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
        Ok(())
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
