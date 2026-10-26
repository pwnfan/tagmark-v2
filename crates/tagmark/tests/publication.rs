use serde_json::Value;
use tagmark::{AssignmentState, Collection};

#[test]
fn legacy_snapshot_cli_preview_and_export_share_defaults_and_order() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("collection.json");
    let input = include_str!("../../../fixtures/publication-legacy.json");
    std::fs::write(&path, input).unwrap();
    let run = |command: &str| {
        let output = std::process::Command::new(env!("CARGO_BIN_EXE_tagmark"))
            .arg("--collection")
            .arg(&path)
            .arg(command)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice::<Value>(&output.stdout).unwrap()
    };
    assert_eq!(
        run("publication-preview")["selectedIds"],
        serde_json::json!([
            "10000000-0000-4000-8000-000000000001",
            "10000000-0000-4000-8000-000000000002"
        ])
    );
    assert_eq!(
        run("public-export"),
        serde_json::json!({"schemaVersion": 1, "tags": [], "bookmarks": [
            {"url": "https://example.com/first", "title": "First resource", "tagIds": []},
            {"url": "https://example.com/second", "title": "Second resource", "tagIds": []}
        ]})
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), input);
}

#[test]
fn snapshot_validation_requires_publication_versions() {
    let mut collection = Collection::default();
    let bookmark = collection
        .save("https://example.com/", "Resource")
        .unwrap()
        .bookmark;
    collection.publication.mode = tagmark::PublicationMode::AllMinusExcluded;
    assert!(
        collection.validate().is_err(),
        "nondefault rules need a version"
    );
    collection
        .publication
        .field_state
        .insert("mode".into(), Default::default());
    collection.bookmarks[0].publication_choice = tagmark::PublicationChoice::ManualPublic;
    assert!(
        collection.validate().is_err(),
        "nondefault choices need a version"
    );
    collection.bookmarks[0]
        .field_state
        .insert("publicationChoice".into(), Default::default());
    collection.validate().unwrap();
    assert_eq!(collection.bookmarks[0].id, bookmark.id);
}

#[test]
fn cli_exports_only_selected_public_fields_and_explains_the_same_selection() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("collection.json");
    let mut collection = Collection::default();
    let tag = collection
        .create_tag(
            "rust",
            "Rust resources.",
            Some("PRIVATE_RULE_SENTINEL"),
            None,
            None,
        )
        .unwrap();
    let unused = collection
        .create_tag(
            "private-unused",
            "PRIVATE_DEFINITION_SENTINEL",
            None,
            None,
            None,
        )
        .unwrap();
    let bookmark = collection
        .save("https://example.com/resource", "Resource")
        .unwrap()
        .bookmark;
    collection
        .assign_tag(&bookmark.id, &tag.id, AssignmentState::Added)
        .unwrap();
    collection
        .assign_tag(&bookmark.id, &unused.id, AssignmentState::Rejected)
        .unwrap();
    collection
        .edit(
            &bookmark.id,
            tagmark::BookmarkEdit {
                private_note: Some("PRIVATE_NOTE_SENTINEL".into()),
                body_excerpt: Some("PRIVATE_BODY_SENTINEL".into()),
                ..Default::default()
            },
        )
        .unwrap();
    collection
        .save("https://private.example.com/", "PRIVATE_BOOKMARK_SENTINEL")
        .unwrap();
    collection.publication.mode = tagmark::PublicationMode::IncludeAny;
    collection.publication.included_tag_ids = vec![tag.id.clone()];
    collection
        .publication
        .field_state
        .insert("mode".into(), Default::default());
    collection
        .publication
        .field_state
        .insert("includedTagIds".into(), Default::default());
    std::fs::write(&path, serde_json::to_vec(&collection).unwrap()).unwrap();
    let run = |command: &str| {
        std::process::Command::new(env!("CARGO_BIN_EXE_tagmark"))
            .arg("--collection")
            .arg(&path)
            .arg(command)
            .output()
            .unwrap()
    };
    let preview = run("publication-preview");
    assert!(
        preview.status.success(),
        "{}",
        String::from_utf8_lossy(&preview.stderr)
    );
    let preview: Value = serde_json::from_slice(&preview.stdout).unwrap();
    assert_eq!(preview["selectedIds"], serde_json::json!([bookmark.id]));
    let output = run("public-export");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap(),
        serde_json::json!({
            "schemaVersion": 1, "bookmarks": [{"url": bookmark.url, "title": "Resource", "tagIds": [tag.id]}],
            "tags": [{"id": tag.id, "name": "rust", "definition": "Rust resources."}]
        })
    );
    assert!(
        !String::from_utf8(output.stdout)
            .unwrap()
            .contains("PRIVATE_")
    );
    collection.tags.retain(|entry| entry.id != tag.id);
    std::fs::write(&path, serde_json::to_vec(&collection).unwrap()).unwrap();
    assert!(
        !run("public-export").status.success(),
        "dangling rules must fail closed"
    );
}

#[test]
fn publication_follows_shared_priority_and_privacy_examples() {
    let examples: Vec<Value> =
        serde_json::from_str(include_str!("../../../fixtures/publication.json")).unwrap();
    for example in examples {
        let mut collection = Collection::default();
        let mut tags = std::collections::BTreeMap::new();
        for name in ["rust", "private", "tool"] {
            let tag = collection
                .create_tag(name, "A short definition", None, None, None)
                .unwrap();
            tags.insert(name, tag.id);
        }
        let bookmark = collection
            .save("https://example.com/", "Resource")
            .unwrap()
            .bookmark;
        for (field, state) in [
            ("added", AssignmentState::Added),
            ("rejected", AssignmentState::Rejected),
        ] {
            if let Some(names) = example[field].as_array() {
                for name in names {
                    collection
                        .assign_tag(&bookmark.id, &tags[name.as_str().unwrap()], state.clone())
                        .unwrap();
                }
            }
        }
        collection.bookmarks[0].publication_choice = serde_json::from_value(
            example
                .get("choice")
                .cloned()
                .unwrap_or("followRules".into()),
        )
        .unwrap();
        collection.bookmarks[0].deleted = example["deleted"].as_bool().unwrap_or(false);
        collection.publication.mode =
            serde_json::from_value(example.get("mode").cloned().unwrap_or("manualOnly".into()))
                .unwrap();
        let ids = |field: &str| {
            example[field]
                .as_array()
                .map(|names| {
                    names
                        .iter()
                        .map(|name| tags[name.as_str().unwrap()].clone())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        };
        collection.publication.included_tag_ids = ids("included");
        collection.publication.excluded_tag_ids = ids("excluded");
        let mut matched = ids("matched");
        matched.sort();
        assert_eq!(
            serde_json::to_value(collection.publication_selection()).unwrap(),
            serde_json::json!([{
                "bookmarkId": bookmark.id, "published": example["published"], "reason": example["reason"], "tagIds": matched
            }]),
            "{}",
            example["name"]
        );
    }
}
