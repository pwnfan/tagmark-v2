# Private repository sync

Create a **private** GitHub.com repository for personal data, separate from the public product repository. Initialize it with a README so its default branch has a commit. An empty TagMark instance has no `tagmark/collection.json`; a repository with no commits is rejected with setup instructions. TagMark never creates repositories or changes their visibility.

Create a fine-grained personal access token restricted to that one repository, with **Contents: read and write** (and GitHub's required Metadata read access). These permissions allow changing repository content, beyond the one snapshot TagMark writes. T11 does not trigger Actions or publish Pages. Future workflow triggering needs **Actions: write**; failure notifications need **Issues: write**; cross-repository publication uses separately scoped credentials. Do not grant those permissions solely for first sync.

In the extension's management page, enter `owner/repository` and the token. Choose session-only storage (default) or remember on this device. Session storage is cleared when Chrome closes; remembered storage is local to this Chrome profile, is not encrypted by TagMark, and survives browser restart. Both use Chrome extension storage restricted to trusted extension contexts, never `storage.sync`, content scripts, collection IndexedDB, downloads, or remote snapshots. Forgetting credentials removes both stored copies. The token field is cleared after saving and never filled with the stored value.

The CLI reads only `TAGMARK_GITHUB_TOKEN` from its process environment. Set it using your shell's secret-entry mechanism or secret manager; do not put a token in an argument, collection file, repository, or command history. Then run:

```text
tagmark --collection collection.json init
tagmark --collection collection.json sync --repository owner/repository
```

CLI sync metadata is stored beside the collection as `collection.json.sync.json`, with a shared baseline and repository identity but no credential. Keep it with the local collection and keep both private. CLI operations lock the collection during sync. External file edits are detected before replacement. The extension also compares its full local snapshot inside the replacement transaction; edits made during network requests stay local and remain unsynced.

A first sync uploads to an empty TagMark instance. A fresh, empty local collection can pull an existing instance. If both sides already contain different data and have no common baseline, sync stops and preserves both sides. After a common baseline exists, one-sided changes can upload or pull; concurrent edits or a changed default branch in the same repository are reported as a conflict, preserving the existing baseline. Explicitly selecting a different repository starts a separate connection. Automatic semantic merge is reserved for T12. Download a local snapshot before manually resolving a conflict; there is no force-overwrite button.

Reads use one immutable Git commit and the raw Contents API. Writes use GraphQL `createCommitOnBranch` with `expectedHeadOid`; a concurrent branch change fails atomically. Repository privacy is checked before reads and again before uploading. Do not change the instance repository's visibility while using it. Redirects are refused, and the production endpoint is fixed to `https://api.github.com`. Responses and credentials are never included in error messages. The application currently accepts snapshots up to **10 MiB**; larger or malformed snapshots fail without replacing local data. This is a TagMark limit, not GitHub's file-size limit.

Sync status is separate from publication/deployment status. Offline edits remain local; after reconnecting, press **Sync now**. Authentication, HTTP, schema and conflict failures keep local changes. A successful upload with newer local edits reports those edits as still unsynced. Sync does not mean a public website was updated.

Protocol references checked on 2026-10-26: [atomic commit and expected head](https://docs.github.com/en/graphql/reference/commits#createcommitonbranchinput), [branch input](https://docs.github.com/en/graphql/reference/git#committablebranch), [raw Contents reads](https://docs.github.com/en/rest/repos/contents#get-repository-content), [Chrome local/session storage and access levels](https://developer.chrome.com/docs/extensions/reference/api/storage).

Automated acceptance uses a controlled HTTP repository service, the actual CLI binary and a real Chrome extension build. A real configured private GitHub repository, token permissions and branch protection rules require separate external acceptance; mock service success does not prove that integration.
