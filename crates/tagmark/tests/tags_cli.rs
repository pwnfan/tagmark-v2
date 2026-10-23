use serde_json::{Value, json};
use std::path::Path;
use std::process::Command;

fn run(path: &Path, args: &[&str]) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_tagmark"))
        .arg("--collection")
        .arg(path)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn tags_keep_a_stable_identity_and_separate_definition_from_rules() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("collection.json");
    run(&path, &["init"]);
    let tag = run(
        &path,
        &[
            "tag-create",
            " Machine-Learning ",
            "--definition",
            "Methods that learn from data.",
            "--inclusion",
            "Resources about learning from data.",
        ],
    );
    assert_eq!(tag["canonicalName"], "machine-learning");
    assert!(uuid::Uuid::parse_str(tag["id"].as_str().unwrap()).is_ok());
    assert_eq!(tag["definition"], "Methods that learn from data.");
    assert_eq!(
        tag["rules"],
        json!({"inclusion":"Resources about learning from data.","exclusion":"","examples":""})
    );
    assert_eq!(
        tag["fieldState"]["definition"],
        json!({"source":"manual","version":1,"protected":true})
    );
    assert_eq!(tag["fieldState"]["rules.inclusion"]["protected"], true);
    assert!(tag["fieldState"].get("rules.exclusion").is_none());
    assert_eq!(run(&path, &["tags"]), json!([tag]));
    let before = std::fs::read(&path).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_tagmark"))
        .arg("--collection")
        .arg(&path)
        .args([
            "tag-create",
            "MACHINE-LEARNING",
            "--definition",
            "Different meaning.",
        ])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("already exists"));
    assert_eq!(std::fs::read(path).unwrap(), before);
}

#[test]
fn editing_a_tag_protects_only_changed_fields_and_preserves_its_identity() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("collection.json");
    run(&path, &["init"]);
    let tag = run(
        &path,
        &["tag-create", "C++", "--definition", "The C++ language."],
    );
    let id = tag["id"].as_str().unwrap();
    let edited = run(
        &path,
        &[
            "tag-edit",
            id,
            "--definition",
            "Resources teaching the C++ language.",
            "--exclusion",
            "Projects merely implemented in C++.",
        ],
    );
    assert_eq!(edited["id"], id);
    assert_eq!(edited["canonicalName"], "c++");
    assert_eq!(edited["definition"], "Resources teaching the C++ language.");
    assert_eq!(edited["fieldState"]["definition"]["version"], 2);
    assert_eq!(
        edited["fieldState"]["rules.exclusion"],
        json!({"source":"manual","version":1,"protected":true})
    );
    assert!(edited["fieldState"].get("rules.inclusion").is_none());
    assert_eq!(
        edited["fieldState"]["canonicalName"],
        tag["fieldState"]["canonicalName"]
    );
    assert_eq!(
        run(
            &path,
            &[
                "tag-edit",
                id,
                "--definition",
                "Resources teaching the C++ language."
            ]
        ),
        edited
    );
    assert_eq!(run(&path, &["tags"]), json!([edited]));
}

#[test]
fn manual_assignments_and_rejections_survive_duplicate_bookmark_saves() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("collection.json");
    run(&path, &["init"]);
    let bookmark = run(
        &path,
        &["save", "https://example.com/", "--title", "My resource"],
    );
    let first = run(
        &path,
        &["tag-create", "http", "--definition", "The HTTP protocol."],
    );
    let second = run(
        &path,
        &["tag-create", "c++", "--definition", "The C++ language."],
    );
    let id = bookmark["bookmark"]["id"].as_str().unwrap();
    let added = first["id"].as_str().unwrap();
    let rejected = second["id"].as_str().unwrap();
    run(&path, &["tag-add", id, added]);
    let decisions = run(&path, &["tag-reject", id, rejected]);
    assert_eq!(
        decisions["tagAssignments"][added],
        json!({"state":"added","source":"manual","version":1,"protected":true})
    );
    assert_eq!(
        decisions["tagAssignments"][rejected],
        json!({"state":"rejected","source":"manual","version":1,"protected":true})
    );
    assert_eq!(
        run(
            &path,
            &["save", "HTTPS://EXAMPLE.COM:443", "--title", "Ignore"]
        )["bookmark"],
        decisions
    );
    let changed = run(&path, &["tag-reject", id, added]);
    assert_eq!(changed["tagAssignments"][added]["version"], 2);
    assert_eq!(changed["tagAssignments"][added]["state"], "rejected");
    assert_eq!(
        changed["tagAssignments"][rejected],
        decisions["tagAssignments"][rejected]
    );
    assert_eq!(run(&path, &["list"]), json!([changed]));
    let before = std::fs::read(&path).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_tagmark"))
        .arg("--collection")
        .arg(&path)
        .args(["tag-add", id, "missing"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("Tag not found"));
    assert_eq!(std::fs::read(path).unwrap(), before);
}

#[test]
fn canonical_english_tag_names_follow_the_shared_examples() {
    let examples: Value =
        serde_json::from_str(include_str!("../../../fixtures/tag-names.json")).unwrap();
    for sample in examples["valid"].as_array().unwrap() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("collection.json");
        run(&path, &["init"]);
        let tag = run(
            &path,
            &[
                "tag-create",
                sample["input"].as_str().unwrap(),
                "--definition",
                "An English definition.",
            ],
        );
        assert_eq!(tag["canonicalName"], sample["expected"]);
    }
    for input in examples["invalid"].as_array().unwrap() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("collection.json");
        run(&path, &["init"]);
        let before = std::fs::read(&path).unwrap();
        let output = Command::new(env!("CARGO_BIN_EXE_tagmark"))
            .arg("--collection")
            .arg(&path)
            .args([
                "tag-create",
                input.as_str().unwrap(),
                "--definition",
                "An English definition.",
            ])
            .output()
            .unwrap();
        assert!(!output.status.success(), "Accepted invalid name: {input}");
        assert_eq!(std::fs::read(path).unwrap(), before);
    }
}

#[test]
fn tag_edits_refuse_unsafe_versions_without_partial_writes() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("collection.json");
    run(&path, &["init"]);
    let tag = run(
        &path,
        &[
            "tag-create",
            "http",
            "--definition",
            "HTTP.",
            "--inclusion",
            "Protocol resources.",
        ],
    );
    let mut snapshot: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    snapshot["tags"][0]["fieldState"]["rules.inclusion"]["version"] =
        json!(9_007_199_254_740_991_u64);
    let original = serde_json::to_vec(&snapshot).unwrap();
    std::fs::write(&path, &original).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_tagmark"))
        .arg("--collection")
        .arg(&path)
        .args([
            "tag-edit",
            tag["id"].as_str().unwrap(),
            "--definition",
            "Changed definition.",
            "--inclusion",
            "Changed inclusion.",
        ])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("version"));
    assert_eq!(std::fs::read(&path).unwrap(), original);
    snapshot["tags"][0]["fieldState"]["rules.inclusion"]["version"] =
        json!(9_007_199_254_740_992_u64);
    std::fs::write(&path, serde_json::to_vec(&snapshot).unwrap()).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_tagmark"))
        .arg("--collection")
        .arg(&path)
        .arg("tags")
        .output()
        .unwrap();
    assert!(!output.status.success());
}

#[test]
fn tag_creation_editing_and_snapshots_share_the_definition_whitespace_contract() {
    let examples: Value =
        serde_json::from_str(include_str!("../../../fixtures/tag-definitions.json")).unwrap();
    for definition in examples["valid"].as_array().unwrap() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("collection.json");
        run(&path, &["init"]);
        let tag = run(
            &path,
            &[
                "tag-create",
                "http",
                "--definition",
                definition.as_str().unwrap(),
            ],
        );
        assert_eq!(tag["definition"], *definition);
        let id = tag["id"].as_str().unwrap();
        run(
            &path,
            &["tag-edit", id, "--definition", "Different definition."],
        );
        let edited = run(
            &path,
            &["tag-edit", id, "--definition", definition.as_str().unwrap()],
        );
        assert_eq!(edited["definition"], *definition);
        assert_eq!(run(&path, &["tags"]), json!([edited]));
    }
    for definition in examples["blank"].as_array().unwrap() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("collection.json");
        run(&path, &["init"]);
        let tag = run(
            &path,
            &["tag-create", "http", "--definition", "Original definition."],
        );
        let id = tag["id"].as_str().unwrap();
        let before = std::fs::read(&path).unwrap();
        for args in [
            vec![
                "tag-create",
                "other",
                "--definition",
                definition.as_str().unwrap(),
            ],
            vec!["tag-edit", id, "--definition", definition.as_str().unwrap()],
        ] {
            let output = Command::new(env!("CARGO_BIN_EXE_tagmark"))
                .arg("--collection")
                .arg(&path)
                .args(args)
                .output()
                .unwrap();
            assert!(
                !output.status.success(),
                "Accepted blank definition: {definition}"
            );
            assert_eq!(std::fs::read(&path).unwrap(), before);
        }
        let mut snapshot: Value = serde_json::from_slice(&before).unwrap();
        snapshot["tags"][0]["definition"] = definition.clone();
        let invalid = serde_json::to_vec(&snapshot).unwrap();
        std::fs::write(&path, &invalid).unwrap();
        let output = Command::new(env!("CARGO_BIN_EXE_tagmark"))
            .arg("--collection")
            .arg(&path)
            .arg("tags")
            .output()
            .unwrap();
        assert!(
            !output.status.success(),
            "Accepted blank snapshot definition: {definition}"
        );
        assert_eq!(std::fs::read(&path).unwrap(), invalid);
    }
}
