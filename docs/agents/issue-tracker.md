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

## Review baseline

The user approved a fixed baseline per ticket: T01 starts at `35e832b445a2e47d508ca65321f0177af4359974`; each later ticket pins the completed preceding ticket's commit before work begins. Review the ticket's change against that immutable commit and the relevant requirements in its parent spec. Record the chosen SHA with the implementation evidence.

## Ticket execution

The main session coordinates tickets, checks evidence, manages reviews, and reports to the user. Starting with T02, delegate product coding and review fixes to a dedicated implementation subagent. Use high reasoning by default and medium for straightforward tickets. The current T01 may be completed by the main session.

Each implementation subagent reads the ticket, relevant domain decisions, and the `implement`, `tdd`, and `ponytail` skills. Apply ponytail throughout. Run one red-to-green behavior at a time at the four user-approved seams in the spec. Choose unit, integration, or browser tests according to the observable behavior; a per-function test suite is not required.

Deliver one cohesive final commit per ticket, with its behavior tests. Keep a checkpoint commit local for the Standards and Spec reviews; fold review fixes into that unpublished commit. Run the affected checks again, report the separate review axes, and conduct `retro` before publishing the ticket's completion evidence. Close a ticket only when its acceptance criteria are demonstrated. Preserve pending external acceptance checks explicitly.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub issues and PRs share a number space; resolve ambiguous references before updating them.
