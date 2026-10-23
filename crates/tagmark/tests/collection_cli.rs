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
