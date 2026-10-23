use serde::Deserialize;
use tagmark::Collection;

#[derive(Deserialize)]
struct Examples {
    normalizations: Vec<Normalization>,
    pairs: Vec<Pair>,
    invalid: Vec<String>,
}

#[derive(Deserialize)]
struct Normalization {
    input: String,
    expected: String,
}

#[derive(Deserialize)]
struct Pair {
    left: String,
    right: String,
    same: bool,
}

#[test]
fn saving_bookmarks_respects_the_shared_url_identity_examples() {
    let examples: Examples =
        serde_json::from_str(include_str!("../../../fixtures/url-identity.json")).unwrap();

    for example in examples.normalizations {
        let saved = Collection::default()
            .save(&example.input, "Example")
            .unwrap();
        assert_eq!(saved.bookmark.url, example.expected, "{}", example.input);
    }
    for pair in examples.pairs {
        let mut collection = Collection::default();
        let first = collection.save(&pair.left, "Original title").unwrap();
        let second = collection.save(&pair.right, "Replacement title").unwrap();
        assert_eq!(
            first.bookmark.id == second.bookmark.id,
            pair.same,
            "{} and {}",
            pair.left,
            pair.right
        );
        assert_eq!(second.created, !pair.same);
        if pair.same {
            assert_eq!(second.bookmark.title, "Original title");
        }
    }
    for input in examples.invalid {
        let mut collection = Collection::default();
        assert!(collection.save(&input, "Invalid").is_err(), "{input}");
        assert!(collection.bookmarks.is_empty());
    }
}
