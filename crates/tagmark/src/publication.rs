use crate::{AssignmentState, Collection, MAX_MANUAL_VERSION, ManualFieldState, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PublicationChoice {
    #[default]
    FollowRules,
    ManualPublic,
    ManualPrivate,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PublicationMode {
    #[default]
    ManualOnly,
    IncludeAny,
    AllMinusExcluded,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationPolicy {
    pub mode: PublicationMode,
    pub included_tag_ids: Vec<String>,
    pub excluded_tag_ids: Vec<String>,
    pub field_state: BTreeMap<String, ManualFieldState>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationDecision {
    pub bookmark_id: String,
    pub published: bool,
    pub reason: &'static str,
    pub tag_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationPreview {
    decisions: Vec<PublicationDecision>,
    selected_ids: Vec<String>,
    count: usize,
    added_ids: Vec<String>,
    removed_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicCollection<'a> {
    schema_version: u32,
    bookmarks: Vec<PublicBookmark<'a>>,
    tags: Vec<PublicTag<'a>>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicBookmark<'a> {
    url: &'a str,
    title: &'a str,
    tag_ids: Vec<&'a str>,
}
#[derive(Debug, Serialize)]
struct PublicTag<'a> {
    id: &'a str,
    name: &'a str,
    definition: &'a str,
}

impl Collection {
    pub fn validate_publication(&self) -> Result<()> {
        let known: HashSet<_> = self.tags.iter().map(|tag| &tag.id).collect();
        for ids in [
            &self.publication.included_tag_ids,
            &self.publication.excluded_tag_ids,
        ] {
            if ids.iter().any(|id| !known.contains(id)) {
                return Err("Unknown publication tag; review the rule references".into());
            }
            if ids.iter().collect::<HashSet<_>>().len() != ids.len() {
                return Err("Duplicate publication tag".into());
            }
        }
        for (field, state) in &self.publication.field_state {
            if !["mode", "includedTagIds", "excludedTagIds"].contains(&field.as_str())
                || state.version == 0
                || state.version > MAX_MANUAL_VERSION
            {
                return Err("Invalid publication field version".into());
            }
        }
        for (field, changed) in [
            ("mode", self.publication.mode != PublicationMode::ManualOnly),
            (
                "includedTagIds",
                !self.publication.included_tag_ids.is_empty(),
            ),
            (
                "excludedTagIds",
                !self.publication.excluded_tag_ids.is_empty(),
            ),
        ] {
            if changed && !self.publication.field_state.contains_key(field) {
                return Err("Publication rules require a field version".into());
            }
        }
        if self.bookmarks.iter().any(|bookmark| {
            bookmark.publication_choice != PublicationChoice::FollowRules
                && !bookmark.field_state.contains_key("publicationChoice")
        }) {
            return Err("Publication choices require a version".into());
        }
        Ok(())
    }

    pub fn publication_preview(&self) -> PublicationPreview {
        let decisions = self.publication_selection();
        let selected_ids: Vec<_> = decisions
            .iter()
            .filter(|decision| decision.published)
            .map(|decision| decision.bookmark_id.clone())
            .collect();
        PublicationPreview {
            count: selected_ids.len(),
            decisions,
            selected_ids,
            added_ids: vec![],
            removed_ids: vec![],
        }
    }

    pub fn public_export(&self) -> Result<PublicCollection<'_>> {
        self.validate()?;
        let selected: HashSet<_> = self
            .publication_selection()
            .into_iter()
            .filter(|decision| decision.published)
            .map(|decision| decision.bookmark_id)
            .collect();
        let mut source: Vec<_> = self
            .bookmarks
            .iter()
            .filter(|bookmark| selected.contains(&bookmark.id))
            .collect();
        source.sort_by_key(|bookmark| &bookmark.id);
        let mut used = HashSet::new();
        let bookmarks = source
            .into_iter()
            .map(|bookmark| {
                let tag_ids: Vec<_> = bookmark
                    .tag_assignments
                    .iter()
                    .filter(|(_, assignment)| assignment.state == AssignmentState::Added)
                    .map(|(id, _)| id.as_str())
                    .collect();
                used.extend(tag_ids.iter().copied());
                PublicBookmark {
                    url: &bookmark.url,
                    title: &bookmark.title,
                    tag_ids,
                }
            })
            .collect();
        let mut tags: Vec<_> = self
            .tags
            .iter()
            .filter(|tag| used.contains(tag.id.as_str()))
            .collect();
        tags.sort_by_key(|tag| &tag.id);
        Ok(PublicCollection {
            schema_version: 1,
            bookmarks,
            tags: tags
                .into_iter()
                .map(|tag| PublicTag {
                    id: &tag.id,
                    name: &tag.canonical_name,
                    definition: &tag.definition,
                })
                .collect(),
        })
    }

    pub fn publication_selection(&self) -> Vec<PublicationDecision> {
        let mut bookmarks: Vec<_> = self.bookmarks.iter().collect();
        bookmarks.sort_by_key(|bookmark| &bookmark.id);
        bookmarks
            .into_iter()
            .map(|bookmark| {
                let active = |ids: &[String]| {
                    let mut matched: Vec<_> = ids
                        .iter()
                        .filter(|id| {
                            bookmark.tag_assignments.get(*id).is_some_and(|assignment| {
                                assignment.state == AssignmentState::Added
                            })
                        })
                        .cloned()
                        .collect();
                    matched.sort();
                    matched
                };
                let excluded = active(&self.publication.excluded_tag_ids);
                let included = active(&self.publication.included_tag_ids);
                let (published, reason, tag_ids) = if bookmark.deleted {
                    (false, "trash", vec![])
                } else if !excluded.is_empty() {
                    (false, "excludedTag", excluded)
                } else if bookmark.publication_choice == PublicationChoice::ManualPrivate {
                    (false, "manualPrivate", vec![])
                } else if bookmark.publication_choice == PublicationChoice::ManualPublic {
                    (true, "manualPublic", vec![])
                } else {
                    match self.publication.mode {
                        PublicationMode::ManualOnly => (false, "manualOnly", vec![]),
                        PublicationMode::IncludeAny if !included.is_empty() => {
                            (true, "includedTag", included)
                        }
                        PublicationMode::IncludeAny => (false, "noIncludedTag", vec![]),
                        PublicationMode::AllMinusExcluded => (true, "allMinusExcluded", vec![]),
                    }
                };
                PublicationDecision {
                    bookmark_id: bookmark.id.clone(),
                    published,
                    reason,
                    tag_ids,
                }
            })
            .collect()
    }
}
