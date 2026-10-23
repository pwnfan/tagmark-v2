import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createManualTag, editManualTag } from "../src/index.ts";

test("tag creation and editing share the definition whitespace contract", () => {
  const examples: { valid: string[]; blank: string[] } = JSON.parse(readFileSync(new URL("../../../fixtures/tag-definitions.json", import.meta.url), "utf8"));
  const id = "1e7b72ce-af31-48d4-8c05-370e74f78a84";
  const original = createManualTag(id, "http", "Initial definition.", {});
  for (const definition of examples.valid) {
    assert.equal(createManualTag(id, "http", definition, {}).definition, definition);
    assert.equal(editManualTag(original, { definition }).definition, definition);
  }
  for (const definition of examples.blank) {
    assert.throws(() => createManualTag(id, "http", definition, {}), /definition/, JSON.stringify(definition));
    assert.throws(() => editManualTag(original, { definition }), /definition/, JSON.stringify(definition));
    assert.equal(original.definition, "Initial definition.");
    assert.equal(original.fieldState.definition!.version, 1);
  }
});
