import assert from "node:assert/strict";
import test from "node:test";
import { createManualTag, editManualTag } from "../src/index.ts";

test("tag edits refuse unsafe versions without changing the original tag", () => {
  const tag = createManualTag("1e7b72ce-af31-48d4-8c05-370e74f78a84", "http", "HTTP.", { inclusion: "Protocol resources." });
  tag.fieldState["rules.inclusion"]!.version = Number.MAX_SAFE_INTEGER;
  const original = structuredClone(tag);
  assert.throws(() => editManualTag(tag, { definition: "Changed definition.", inclusion: "Changed inclusion." }), /version/);
  assert.deepEqual(tag, original);
});
