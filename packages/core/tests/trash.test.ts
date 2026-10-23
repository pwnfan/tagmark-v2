import assert from "node:assert/strict";
import test from "node:test";
import { bookmarkWithDefaults, setBookmarkDeleted, type Bookmark } from "../src/index.ts";

test("explicit deletion and restore retain content and advance only the deletion revision", () => {
  const original = bookmarkWithDefaults({ id: "2c60f487-b591-41ba-9821-18c61f38abf3", url: "https://example.com/",
    title: "Keep this", deleted: false, fieldState: { title: { source: "manual", version: 7, protected: true } } });
  const deleted = setBookmarkDeleted(original, true);
  assert.deepEqual(deleted, { ...original, deleted: true, fieldState: { ...original.fieldState,
    deleted: { source: "manual", version: 1, protected: true } } });
  assert.deepEqual(setBookmarkDeleted(deleted, true), deleted);
  const restored = setBookmarkDeleted(deleted, false);
  assert.deepEqual(restored, { ...original, fieldState: { ...original.fieldState,
    deleted: { source: "manual", version: 2, protected: true } } });
  assert.deepEqual(setBookmarkDeleted(restored, false), restored);
  assert.throws(() => bookmarkWithDefaults({ ...original, deleted: true }), /deletion version/);
  for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
    const unsafe: Bookmark = { ...deleted, fieldState: { deleted: { source: "manual", version, protected: true } } };
    assert.throws(() => setBookmarkDeleted(unsafe, false), /version/);
    assert.equal(unsafe.deleted, true);
  }
});
