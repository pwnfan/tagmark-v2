use std::process::Command;

#[test]
fn snapshot_validation_matches_the_shared_typescript_boundary_fixtures() {
    let cases: serde_json::Value =
        serde_json::from_str(include_str!("../../../fixtures/sync-snapshots.json")).unwrap();
    for case in cases["valid"].as_array().unwrap() {
        let snapshot: tagmark::Collection =
            serde_json::from_value(case["snapshot"].clone()).unwrap();
        snapshot.validate().unwrap();
    }
    for case in cases["invalid"].as_array().unwrap() {
        let rejected = match serde_json::from_value::<tagmark::Collection>(case["snapshot"].clone())
        {
            Ok(snapshot) => snapshot.validate().is_err(),
            Err(_) => true,
        };
        assert!(rejected, "{}", case["name"]);
    }
}

#[test]
fn sync_requires_an_environment_credential_without_changing_the_collection() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("collection.json");
    std::fs::write(&path, r#"{"schemaVersion":1,"bookmarks":[],"tags":[]}"#).unwrap();
    let before = std::fs::read(&path).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_tagmark"))
        .args([
            "--collection",
            path.to_str().unwrap(),
            "sync",
            "--repository",
            "person/data",
        ])
        .env_remove("TAGMARK_GITHUB_TOKEN")
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("TAGMARK_GITHUB_TOKEN"));
    assert_eq!(std::fs::read(&path).unwrap(), before);
}
