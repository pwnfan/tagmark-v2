use serde_json::Value;
use std::path::Path;
use std::process::Command;

fn run(collection: &Path, arguments: &[&str]) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_tagmark"))
        .arg("--collection")
        .arg(collection)
        .args(arguments)
        .output()
        .expect("CLI should start");
    assert!(
        output.status.success(),
        "CLI failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("CLI should return JSON")
}

#[test]
fn trash_retains_the_original_until_explicit_restore() {
    let directory = tempfile::tempdir().unwrap();
    let collection = directory.path().join("collection.json");
    run(&collection, &["init"]);
    let saved = run(
        &collection,
        &[
            "save",
            "https://example.com/keep",
            "--title",
            "Keep my title",
        ],
    );
    let id = saved["bookmark"]["id"].as_str().unwrap();
    run(
        &collection,
        &[
            "edit",
            id,
            "--private-note",
            "Private decision",
            "--description",
            "Retained description",
            "--body-excerpt",
            "Retained paragraph",
            "--include-body",
            "true",
            "--skip-ai",
            "true",
        ],
    );
    let added = run(
        &collection,
        &["tag-create", "reading", "--definition", "Reading material"],
    );
    let rejected = run(
        &collection,
        &[
            "tag-create",
            "unrelated",
            "--definition",
            "Unrelated material",
        ],
    );
    run(&collection, &["tag-add", id, added["id"].as_str().unwrap()]);
    let original = run(
        &collection,
        &["tag-reject", id, rejected["id"].as_str().unwrap()],
    );
    let deleted = run(&collection, &["delete", id]);
    assert_eq!(deleted["id"], original["id"]);
    assert_eq!(deleted["title"], original["title"]);
    assert_eq!(deleted["url"], original["url"]);
    assert_eq!(deleted["deleted"], true);
    assert_eq!(
        deleted["fieldState"]["deleted"],
        serde_json::json!({"source":"manual","version":1,"protected":true})
    );
    assert_eq!(run(&collection, &["list"]), serde_json::json!([]));
    assert_eq!(
        run(&collection, &["list", "--trash"]),
        serde_json::json!([deleted])
    );
    let duplicate = run(
        &collection,
        &["save", "https://example.com/keep", "--title", "Replacement"],
    );
    assert_eq!(duplicate["created"], false);
    assert_eq!(duplicate["bookmark"], deleted);
    assert_eq!(run(&collection, &["delete", id]), deleted);
    let mut expected_deleted = original.clone();
    expected_deleted["deleted"] = true.into();
    expected_deleted["fieldState"]["deleted"] =
        serde_json::json!({"source":"manual","version":1,"protected":true});
    assert_eq!(deleted, expected_deleted);
    let edited_in_trash = run(
        &collection,
        &["edit", id, "--private-note", "Edited while in Trash"],
    );
    expected_deleted["privateNote"] = "Edited while in Trash".into();
    expected_deleted["fieldState"]["privateNote"]["version"] = 2.into();
    assert_eq!(edited_in_trash, expected_deleted);
    assert_eq!(run(&collection, &["list"]), serde_json::json!([]));
    let snapshot: Value = serde_json::from_slice(&std::fs::read(&collection).unwrap()).unwrap();
    assert_eq!(snapshot["bookmarks"], serde_json::json!([edited_in_trash]));
    assert_eq!(snapshot["tags"], run(&collection, &["tags"]));
    let restored = run(&collection, &["restore", id]);
    assert_eq!(restored["deleted"], false);
    assert_eq!(restored["fieldState"]["deleted"]["version"], 2);
    assert_eq!(restored["id"], original["id"]);
    assert_eq!(restored["title"], original["title"]);
    assert_eq!(restored["url"], original["url"]);
    expected_deleted["deleted"] = false.into();
    expected_deleted["fieldState"]["deleted"]["version"] = 2.into();
    assert_eq!(restored, expected_deleted);
    assert_eq!(run(&collection, &["list"]), serde_json::json!([restored]));
    assert_eq!(
        run(&collection, &["list", "--trash"]),
        serde_json::json!([])
    );
    assert_eq!(run(&collection, &["restore", id]), restored);
}

#[test]
fn legacy_bookmarks_default_to_active_and_invalid_deletion_versions_do_not_write() {
    let directory = tempfile::tempdir().unwrap();
    let collection = directory.path().join("collection.json");
    let id = "2c60f487-b591-41ba-9821-18c61f38abf3";
    let legacy = serde_json::json!({ "id": id, "url": "https://example.com/", "title": "Legacy" });
    std::fs::write(
        &collection,
        serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"bookmarks":[legacy]})).unwrap(),
    )
    .unwrap();
    assert_eq!(run(&collection, &["list"])[0]["deleted"], false);
    assert_eq!(
        run(&collection, &["delete", id])["fieldState"]["deleted"]["version"],
        1
    );

    for state in [
        serde_json::Value::Null,
        serde_json::json!({"source":"manual","version":0,"protected":true}),
        serde_json::json!({"source":"manual","version":1.5,"protected":true}),
        serde_json::json!({"source":"manual","version":9_007_199_254_740_992_u64,"protected":true}),
        serde_json::json!({"source":"manual","version":9_007_199_254_740_991_u64,"protected":true}),
    ] {
        let mut bookmark = legacy.clone();
        bookmark["deleted"] = true.into();
        if !state.is_null() {
            bookmark["fieldState"] = serde_json::json!({"deleted":state});
        }
        let original =
            serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"bookmarks":[bookmark]}))
                .unwrap();
        std::fs::write(&collection, &original).unwrap();
        let output = Command::new(env!("CARGO_BIN_EXE_tagmark"))
            .arg("--collection")
            .arg(&collection)
            .args(["restore", id])
            .output()
            .unwrap();
        assert!(
            !output.status.success(),
            "Unsafe deletion state was accepted: {state}"
        );
        assert_eq!(std::fs::read(&collection).unwrap(), original);
    }
}

#[test]
fn saved_bookmark_can_be_listed_after_the_process_restarts() {
    let directory = tempfile::tempdir().unwrap();
    let collection = directory.path().join("collection.json");
    run(&collection, &["init"]);

    let saved = run(
        &collection,
        &[
            "save",
            "https://example.com/article#intro",
            "--title",
            "An article",
        ],
    );
    let listed = run(&collection, &["list"]);

    assert_eq!(saved["created"], true);
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["id"], saved["bookmark"]["id"]);
    assert!(listed[0]["id"].as_str().unwrap().len() > 10);
    assert_eq!(listed[0]["url"], "https://example.com/article#intro");
    assert_eq!(listed[0]["title"], "An article");
}

#[test]
fn edits_keep_identity_and_duplicate_saves_preserve_manual_content() {
    let directory = tempfile::tempdir().unwrap();
    let collection = directory.path().join("collection.json");
    run(&collection, &["init"]);
    let saved = run(&collection, &["save", "https://example.com/original"]);
    let id = saved["bookmark"]["id"].as_str().unwrap();
    run(
        &collection,
        &[
            "edit",
            id,
            "--url",
            "HTTPS://EXAMPLE.COM:443/edited",
            "--title",
            "My title",
            "--private-note",
            "Keep this private",
        ],
    );
    let duplicate = run(
        &collection,
        &[
            "save",
            "https://example.com/edited",
            "--title",
            "Replacement",
        ],
    );
    assert_eq!(duplicate["created"], false);
    let listed = run(&collection, &["list"]);
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["id"], id);
    assert_eq!(listed[0]["url"], "https://example.com/edited");
    assert_eq!(listed[0]["title"], "My title");
    assert_eq!(listed[0]["privateNote"], "Keep this private");
    assert_eq!(
        listed[0]["fieldState"]["title"],
        serde_json::json!({"source":"manual","version":1,"protected":true})
    );
    assert!(
        listed[0]["fieldState"]
            .get("evidence.description")
            .is_none()
    );
}

#[test]
fn ai_evidence_is_an_explicit_projection_and_respects_persisted_choices() {
    let directory = tempfile::tempdir().unwrap();
    let collection = directory.path().join("collection.json");
    run(&collection, &["init"]);
    let saved = run(
        &collection,
        &["save", "https://example.com/", "--title", "Page title"],
    );
    let id = saved["bookmark"]["id"].as_str().unwrap();
    run(
        &collection,
        &[
            "edit",
            id,
            "--private-note",
            "Private decision",
            "--description",
            "Page description",
            "--body-excerpt",
            "Allowed paragraph",
        ],
    );
    assert_eq!(
        run(&collection, &["ai-evidence", id]),
        serde_json::json!({"title":"Page title","description":"Page description"})
    );
    run(&collection, &["edit", id, "--include-body", "true"]);
    assert_eq!(
        run(&collection, &["ai-evidence", id]),
        serde_json::json!({"title":"Page title","description":"Page description","bodyExcerpt":"Allowed paragraph"})
    );
    run(&collection, &["edit", id, "--skip-ai", "true"]);
    assert_eq!(run(&collection, &["ai-evidence", id]), Value::Null);
    let bookmark = &run(&collection, &["list"])[0];
    assert_eq!(
        bookmark["ai"],
        serde_json::json!({"includeBody":true,"skip":true})
    );
    assert_eq!(bookmark["evidence"]["bodyExcerpt"], "Allowed paragraph");
    assert_eq!(bookmark["privateNote"], "Private decision");
    run(
        &collection,
        &["edit", id, "--skip-ai", "false", "--include-body", "false"],
    );
    assert_eq!(
        run(&collection, &["ai-evidence", id]),
        serde_json::json!({"title":"Page title","description":"Page description"})
    );
}

#[test]
fn invalid_or_colliding_edits_leave_the_entire_snapshot_unchanged() {
    let directory = tempfile::tempdir().unwrap();
    let collection = directory.path().join("collection.json");
    run(&collection, &["init"]);
    let saved = run(&collection, &["save", "https://example.com/first"]);
    run(&collection, &["save", "https://example.com/second"]);
    let id = saved["bookmark"]["id"].as_str().unwrap();
    let original = std::fs::read(&collection).unwrap();
    for url in [
        "HTTPS://EXAMPLE.COM:443/second",
        "javascript:alert(1)",
        "https://user:password@example.com/",
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_tagmark"))
            .arg("--collection")
            .arg(&collection)
            .args(["edit", id, "--url", url, "--title", "Must not change"])
            .output()
            .unwrap();
        assert!(!output.status.success(), "Invalid edit accepted: {url}");
        assert_eq!(std::fs::read(&collection).unwrap(), original);
    }
}

#[test]
fn field_versions_are_exact_in_javascript_and_exhaustion_cannot_partially_edit() {
    let directory = tempfile::tempdir().unwrap();
    let collection = directory.path().join("collection.json");
    let id = "2c60f487-b591-41ba-9821-18c61f38abf3";
    for version in [0_u64, 9_007_199_254_740_991, 9_007_199_254_740_992] {
        let original = serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"bookmarks":[{
            "id":id,"url":"https://example.com/","title":"Original",
            "fieldState":{"title":{"source":"manual","version":version,"protected":true}}
        }]}))
        .unwrap();
        std::fs::write(&collection, &original).unwrap();
        let output = Command::new(env!("CARGO_BIN_EXE_tagmark"))
            .arg("--collection")
            .arg(&collection)
            .args([
                "edit",
                id,
                "--url",
                "https://example.com/changed",
                "--title",
                "Changed",
            ])
            .output()
            .unwrap();
        assert!(
            !output.status.success(),
            "Invalid/exhausted version accepted: {version}"
        );
        assert_eq!(std::fs::read(&collection).unwrap(), original);
    }
}

#[test]
fn an_unknown_snapshot_version_is_not_overwritten() {
    let directory = tempfile::tempdir().unwrap();
    let collection = directory.path().join("collection.json");
    let original = br#"{"schemaVersion":99,"bookmarks":[]}"#;
    std::fs::write(&collection, original).unwrap();

    let output = Command::new(env!("CARGO_BIN_EXE_tagmark"))
        .arg("--collection")
        .arg(&collection)
        .args(["save", "https://example.com/"])
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("schema version"));
    assert_eq!(std::fs::read(collection).unwrap(), original);
}

#[test]
fn an_invalid_snapshot_is_rejected_without_rewriting_it() {
    let id = "2c60f487-b591-41ba-9821-18c61f38abf3";
    let other_id = "07b5361e-af90-4c47-bd08-cb7bd8a43ba1";
    for bookmarks in [
        serde_json::json!([{ "id": "not-a-uuid", "url": "https://example.com/", "title": "First" }]),
        serde_json::json!([{ "id": id, "url": "javascript:alert(1)", "title": "First" }]),
        serde_json::json!([{ "id": id, "url": "HTTPS://EXAMPLE.COM", "title": "First" }]),
        serde_json::json!([
            { "id": id, "url": "https://example.com/first", "title": "First" },
            { "id": id, "url": "https://example.com/second", "title": "Second" }
        ]),
        serde_json::json!([
            { "id": id, "url": "https://example.com/", "title": "First" },
            { "id": other_id, "url": "https://example.com/", "title": "Second" }
        ]),
    ] {
        let directory = tempfile::tempdir().unwrap();
        let collection = directory.path().join("collection.json");
        let original =
            serde_json::to_vec(&serde_json::json!({ "schemaVersion": 1, "bookmarks": bookmarks }))
                .unwrap();
        std::fs::write(&collection, &original).unwrap();
        let output = Command::new(env!("CARGO_BIN_EXE_tagmark"))
            .arg("--collection")
            .arg(&collection)
            .args(["save", "https://example.com/new"])
            .output()
            .unwrap();
        assert!(
            !output.status.success(),
            "Invalid snapshot was accepted: {bookmarks}"
        );
        assert_eq!(std::fs::read(collection).unwrap(), original);
    }
}
