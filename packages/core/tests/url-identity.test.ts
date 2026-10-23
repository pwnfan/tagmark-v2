import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeBookmarkUrl } from "../src/index.ts";

const examples: {
  normalizations: { input: string; expected: string }[];
  pairs: { left: string; right: string; same: boolean }[];
  invalid: string[];
} = JSON.parse(readFileSync(new URL("../../../fixtures/url-identity.json", import.meta.url), "utf8"));

test("bookmark URL identity follows the accepted shared examples", () => {
  for (const { input, expected } of examples.normalizations) {
    assert.equal(normalizeBookmarkUrl(input), expected, input);
  }
  for (const { left, right, same } of examples.pairs) {
    assert.equal(normalizeBookmarkUrl(left) === normalizeBookmarkUrl(right), same, `${left} and ${right}`);
  }
  for (const input of examples.invalid) {
    assert.throws(() => normalizeBookmarkUrl(input), input);
  }
});
