# Domain docs

This repo uses a single domain context, even though the CLI, extension, and website share one code repository.

## Before exploring or changing behavior

- Read the root `GLOSSARY.md` for product vocabulary.
- Read the relevant accepted decisions in `docs/adr/` for the area being changed.
- Read the active ticket and its parent Spec Issue; `docs/specs/tagmark-v2.md` is the checked-in V2 spec. `docs/design-overview.md` is the navigation overview, and `docs/design-session.md` records the historical questions and superseded proposals.
- If an optional domain document is absent, proceed without creating a substitute merely to fill the gap.

Use glossary terms in issue titles, code-facing concepts, tests, and documentation. If a proposed change conflicts with an accepted ADR, surface that conflict explicitly before changing the decision. Do not treat an older interview proposal as authority over the accepted spec and ADRs.

Keep new decisions in the relevant ADR and new terminology in the glossary; keep root agent instructions short and link to those sources.
