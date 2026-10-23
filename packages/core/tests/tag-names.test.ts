import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalTagName } from "../src/index.ts";

test("canonical English tag names follow the shared examples", () => {
  const examples = JSON.parse(readFileSync(new URL("../../../fixtures/tag-names.json", import.meta.url), "utf8"));
  for (const { input, expected } of examples.valid) assert.equal(canonicalTagName(input), expected);
  for (const input of examples.invalid) assert.throws(() => canonicalTagName(input), /English canonical name/, input);
});
