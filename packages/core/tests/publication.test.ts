import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { bookmarkWithDefaults, createManualTag, setManualTagAssignment, type CollectionSnapshot } from "../src/index.ts";
import { defaultPublicationPolicy, editPublicationPolicy, setPublicationChoice, previewPublication, exportPublicCollection,
  publicationSelection, type PublicationChoice, type PublicationMode } from "../src/publication.ts";

test("legacy snapshot preview and public export share defaults without mutating private input", () => {
  const snapshot: CollectionSnapshot = JSON.parse(readFileSync(new URL("../../../fixtures/publication-legacy.json", import.meta.url), "utf8"));
  const before = JSON.stringify(snapshot);
  assert.deepEqual(previewPublication(snapshot).selectedIds, ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"]);
  assert.deepEqual(exportPublicCollection(snapshot), { schemaVersion: 1, tags: [], bookmarks: [
    { url: "https://example.com/first", title: "First resource", tagIds: [] },
    { url: "https://example.com/second", title: "Second resource", tagIds: [] },
  ] });
  assert.equal(JSON.stringify(snapshot), before);
});

test("publication follows the shared priority and privacy examples", () => {
  const examples: { name: string; mode?: PublicationMode; included?: string[]; excluded?: string[]; added: string[];
    rejected?: string[]; choice?: PublicationChoice; deleted?: boolean; published: boolean; reason: string; matched?: string[] }[] =
    JSON.parse(readFileSync(new URL("../../../fixtures/publication.json", import.meta.url), "utf8"));
  for (const example of examples) {
    let bookmark = bookmarkWithDefaults({ id: "bookmark", url: "https://example.com/", title: "Resource" });
    for (const tag of example.added) bookmark = setManualTagAssignment(bookmark, tag, "added");
    for (const tag of example.rejected ?? []) bookmark = setManualTagAssignment(bookmark, tag, "rejected");
    bookmark = { ...bookmark, publicationChoice: example.choice ?? "followRules", deleted: example.deleted ?? false };
    assert.deepEqual(publicationSelection([bookmark], { mode: example.mode ?? "manualOnly", includedTagIds: example.included ?? [],
      excludedTagIds: example.excluded ?? [], fieldState: {} }), [{ bookmarkId: "bookmark", published: example.published,
      reason: example.reason, tagIds: example.matched ?? [] }], example.name);
  }
});

test("unversioned publication decisions and malformed associations fail closed at export", () => {
  const tag = createManualTag("private-id", "private", "Private resources.", {});
  const bookmark = bookmarkWithDefaults({ id: "a", url: "https://example.com/", title: "Resource" });
  const snapshot: CollectionSnapshot = { schemaVersion: 1, tags: [tag], bookmarks: [bookmark] };
  assert.throws(() => exportPublicCollection({ ...snapshot, publication: { ...defaultPublicationPolicy(), mode: "allMinusExcluded" } }), /version/);
  assert.throws(() => exportPublicCollection({ ...snapshot, bookmarks: [{ ...bookmark, publicationChoice: "manualPublic" }] }), /version/);
  const published = setPublicationChoice(bookmark, "manualPublic");
  const malformed = { ...published, tagAssignments: { [tag.id]: { state: "invalid", source: "manual", version: 1, protected: true } } };
  assert.throws(() => exportPublicCollection({ ...snapshot, bookmarks: [malformed as typeof published] }), /assignment/);
});

test("preview explains changes before saving and public export projects only admitted display data", () => {
  const rust = createManualTag("rust-id", "rust", "Rust resources.", { inclusion: "PRIVATE_RULE_SENTINEL" });
  const unused = createManualTag("unused-id", "unused-private", "PRIVATE_DEFINITION_SENTINEL", {});
  let bookmark = bookmarkWithDefaults({ id: "a", url: "https://example.com/resource", title: "Resource", privateNote: "PRIVATE_NOTE_SENTINEL",
    evidence: { description: "PRIVATE_DESCRIPTION_SENTINEL", bodyExcerpt: "PRIVATE_BODY_SENTINEL" } });
  bookmark = setManualTagAssignment(bookmark, rust.id, "added");
  bookmark = setManualTagAssignment(bookmark, unused.id, "rejected");
  const hidden = bookmarkWithDefaults({ id: "b", url: "https://private.example.com/", title: "PRIVATE_BOOKMARK_SENTINEL" });
  const snapshot: CollectionSnapshot = { schemaVersion: 1, bookmarks: [bookmark, hidden], tags: [rust, unused] };
  const policy = editPublicationPolicy(defaultPublicationPolicy(), { mode: "includeAny", includedTagIds: [rust.id] }, snapshot.tags);
  const preview = previewPublication(snapshot, policy);
  assert.deepEqual({ count: preview.count, added: preview.addedIds, removed: preview.removedIds, selected: preview.selectedIds },
    { count: 1, added: ["a"], removed: [], selected: ["a"] });
  assert.equal(snapshot.publication, undefined);
  assert.equal(policy.fieldState.mode?.version, 1);
  const saved = { ...snapshot, publication: policy };
  assert.deepEqual(exportPublicCollection(saved), { schemaVersion: 1, bookmarks: [{ url: bookmark.url, title: "Resource", tagIds: [rust.id] }],
    tags: [{ id: rust.id, name: "rust", definition: "Rust resources." }] });
  assert.doesNotMatch(JSON.stringify(exportPublicCollection(saved)), /PRIVATE_|fieldState|tagAssignments|rules|evidence|publication|protected/);
  const privateChoice = setPublicationChoice(bookmark, "manualPrivate");
  const privatePreview = previewPublication(saved, policy, { a: "manualPrivate" });
  assert.deepEqual(privatePreview.removedIds, ["a"]);
  assert.equal(privateChoice.fieldState.publicationChoice?.version, 1);
  assert.equal(setPublicationChoice(privateChoice, "followRules").fieldState.publicationChoice?.version, 2);
  assert.deepEqual(setPublicationChoice(privateChoice, "manualPrivate"), privateChoice);
  assert.throws(() => editPublicationPolicy(policy, { excludedTagIds: ["missing"] }, saved.tags), /Unknown publication tag/);
  assert.throws(() => exportPublicCollection({ ...saved, tags: [unused] }), /Unknown publication tag/);
  assert.throws(() => editPublicationPolicy(policy, { mode: "invalid" as PublicationMode }, saved.tags), /mode/);
  assert.throws(() => setPublicationChoice(bookmark, "invalid" as PublicationChoice), /choice/);
  const renamed = { ...saved, tags: [{ ...rust, canonicalName: "rust-renamed" }, unused] };
  assert.deepEqual(exportPublicCollection(renamed).bookmarks, exportPublicCollection(saved).bookmarks);
  assert.equal(exportPublicCollection(renamed).tags[0]?.name, "rust-renamed");
});
