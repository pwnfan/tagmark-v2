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
