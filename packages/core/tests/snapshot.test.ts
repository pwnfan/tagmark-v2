import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSnapshot } from "../src/snapshot.ts";
import { editBookmarkFields } from "../src/index.ts";

const fixtures = JSON.parse(readFileSync(new URL("../../../fixtures/sync-snapshots.json", import.meta.url), "utf8")) as { valid: { name: string; snapshot: unknown }[]; invalid: { name: string; snapshot: unknown }[] };
test("private snapshots share Rust and TypeScript validation, defaults and preservation", () => {
  for (const fixture of fixtures.valid) assert.doesNotThrow(() => parseSnapshot(fixture.snapshot), fixture.name);
  for (const fixture of fixtures.invalid) assert.throws(() => parseSnapshot(fixture.snapshot), Error, fixture.name);
  const kept = parseSnapshot(fixtures.valid[1]!.snapshot);
  assert.equal(kept.bookmarks[0]!.privateNote, "Private note");
  assert.equal(kept.bookmarks[0]!.fieldState.deleted!.version, 2);
  assert.equal(kept.bookmarks[0]!.tagAssignments[kept.tags[0]!.id]!.state, "rejected");
  kept.tags[0]!.definition = "\u0085";
  assert.throws(() => parseSnapshot(kept), /definition/);
  const legacy = parseSnapshot(fixtures.valid.find((fixture) => fixture.name === "legacy bookmark with absent additive fields")!.snapshot);
  assert.deepEqual(legacy.bookmarks[0]!.fieldState, {});
  assert.deepEqual(legacy.bookmarks[0]!.tagAssignments, {});
  assert.deepEqual(legacy.bookmarks[0]!.evidence, { description: "", bodyExcerpt: "" });
  assert.deepEqual(legacy.bookmarks[0]!.ai, { includeBody: false, skip: false });
  assert.equal(editBookmarkFields(legacy.bookmarks[0]!, { title: "Editable legacy" }).title, "Editable legacy");
});
