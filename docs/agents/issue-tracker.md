# Issue tracker: GitHub

Specs and tickets live in https://github.com/pwnfan/tagmark-v2/issues. Use the `gh` CLI for tracker operations, with `--repo pwnfan/tagmark-v2` when the command supports it. The repository's Git remote identifies this same code repository; personal instance repositories are separate.

## Reading and publishing

- When a skill says "publish to the issue tracker", create a GitHub issue. When it says "fetch the relevant ticket", read the full issue body, labels, and comments.
- Read: `gh issue view <number> --repo pwnfan/tagmark-v2 --json number,title,body,labels,comments`.
- List: `gh issue list --repo pwnfan/tagmark-v2 --state open --json number,title,body,labels,assignees`, with the relevant label filters.
- For multiline issue, comment, or PR text, save the exact UTF-8 body to a temporary file and pass `--body-file <path>`. Preserve real newlines. Do not interpolate shell code into bodies.
- Create: `gh issue create --repo pwnfan/tagmark-v2 --title "..." --body-file <path> --label ready-for-agent` after the relevant skill's required review.
- Edit labels, assign, comment, and close using `gh issue edit`, `gh issue comment`, and `gh issue close`; use the label mapping in `triage-labels.md`.
- A checked-in spec is a readable source document; its published parent issue is the tracker entry. Keep approved scope consistent when either is updated. Tickets hold execution status and evidence.

## Parent issues and blockers

- Each approved ticket from a Spec Issue is its native GitHub sub-issue. Use supported `gh` sub-issue commands, or the REST sub-issue endpoint through `gh api`.
- Express blockers with GitHub's native issue dependencies. The REST endpoint is `repos/pwnfan/tagmark-v2/issues/<child-number>/dependencies/blocked_by` with `issue_id` equal to the blocker's database ID, not its issue number or node ID.
- Obtain database IDs with `gh api repos/pwnfan/tagmark-v2/issues/<number> --jq .id`. Sub-issue attachment uses the child database ID as `sub_issue_id` at `repos/pwnfan/tagmark-v2/issues/<parent-number>/sub_issues`.
- If native relationships are unavailable, preserve them in issue bodies with `Part of #<parent>` and `Blocked by: #<blocker>` and report the fallback.
- Work only on tickets whose blockers are closed. A ready-for-agent label does not remove a blocking edge. Do not close or rewrite the parent Spec Issue while performing ticket decomposition.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub issues and PRs share a number space; resolve ambiguous references before updating them.
