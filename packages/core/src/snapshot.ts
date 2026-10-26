import { bookmarkWithDefaults, createManualTag, normalizeBookmarkUrl, type CollectionSnapshot } from "./index.ts";
import { defaultPublicationPolicy, validatePublicationPolicy } from "./publication.ts";

function object(value: unknown, keys?: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid snapshot object");
  if (keys && Object.keys(value).some((key) => !keys.includes(key))) throw new Error("Unknown snapshot field");
  return value as Record<string, unknown>;
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new Error("Invalid snapshot text");
}
function flag(value: unknown) { if (typeof value !== "boolean") throw new Error("Invalid snapshot boolean"); }
function uuid(value: unknown) {
  text(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new Error("Invalid snapshot identity");
}
function states(value: unknown, allowed?: string[], assignments = false) {
  for (const [field, raw] of Object.entries(object(value))) {
    if (allowed && !allowed.includes(field)) throw new Error("Invalid snapshot field state");
    const state = object(raw, assignments ? ["source", "version", "protected", "state"] : ["source", "version", "protected"]);
    if (state.source !== "manual" || !Number.isSafeInteger(state.version) || (state.version as number) < 1) throw new Error("Invalid snapshot field version");
    flag(state.protected);
    if (assignments && state.state !== "added" && state.state !== "rejected") throw new Error("Invalid snapshot tag assignment");
  }
}

/** Untrusted snapshot input is validated before any local transaction is opened. */
export function parseSnapshot(input: unknown): CollectionSnapshot {
  const root = object(input, ["schemaVersion", "bookmarks", "tags", "publication"]);
  if (root.schemaVersion !== 1) throw new Error("Unsupported snapshot schema version");
  if (!Array.isArray(root.bookmarks) || (root.tags !== undefined && !Array.isArray(root.tags))) throw new Error("Invalid snapshot records");
  const tags = (root.tags ?? []) as unknown[];
  const tagIds = new Set<string>();
  const tagNames = new Set<string>();
  for (const raw of tags) {
    const tag = object(raw, ["id", "canonicalName", "definition", "rules", "fieldState"]);
    uuid(tag.id); text(tag.canonicalName); text(tag.definition);
    if (createManualTag(tag.id as string, tag.canonicalName, tag.definition, {}).canonicalName !== tag.canonicalName) throw new Error("Invalid snapshot tag");
    if (tagIds.has(tag.id as string) || tagNames.has(tag.canonicalName)) throw new Error("Duplicate snapshot tag");
    tagIds.add(tag.id as string); tagNames.add(tag.canonicalName);
    const rules = object(tag.rules, ["inclusion", "exclusion", "examples"]);
    for (const key of ["inclusion", "exclusion", "examples"]) text(rules[key]);
    states(tag.fieldState, ["canonicalName", "definition", "rules.inclusion", "rules.exclusion", "rules.examples"]);
  }
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const raw of root.bookmarks) {
    const bookmark = object(raw, ["id", "url", "title", "deleted", "publicationChoice", "tagAssignments", "privateNote", "fieldState", "evidence", "ai"]);
    uuid(bookmark.id); text(bookmark.url); text(bookmark.title);
    if (normalizeBookmarkUrl(bookmark.url) !== bookmark.url || ids.has(bookmark.id as string) || urls.has(bookmark.url)) throw new Error("Invalid or duplicate snapshot bookmark");
    ids.add(bookmark.id as string); urls.add(bookmark.url);
    if (bookmark.privateNote !== undefined) text(bookmark.privateNote);
    if (bookmark.deleted !== undefined) flag(bookmark.deleted);
    if (bookmark.evidence !== undefined) {
      const evidence = object(bookmark.evidence, ["description", "bodyExcerpt"]);
      text(evidence.description); text(evidence.bodyExcerpt);
    }
    if (bookmark.ai !== undefined) {
      const ai = object(bookmark.ai, ["includeBody", "skip"]);
      flag(ai.includeBody); flag(ai.skip);
    }
    states(bookmark.fieldState === undefined ? {} : bookmark.fieldState);
    const assignments = bookmark.tagAssignments === undefined ? {} : bookmark.tagAssignments;
    states(assignments, undefined, true);
    for (const id of Object.keys(object(assignments))) if (!tagIds.has(id)) throw new Error("Unknown snapshot tag reference");
  }
  const publication = root.publication === undefined ? defaultPublicationPolicy() : object(root.publication, ["mode", "includedTagIds", "excludedTagIds", "fieldState"]);
  states(publication.fieldState, ["mode", "includedTagIds", "excludedTagIds"]);
  const snapshot = structuredClone({ ...root, tags, publication }) as unknown as CollectionSnapshot;
  snapshot.bookmarks = snapshot.bookmarks.map(bookmarkWithDefaults);
  validatePublicationPolicy(snapshot.publication!, snapshot.tags);
  return snapshot;
}

/** Sorting affects serialization only; identities and field versions are unchanged. */
export function snapshotText(snapshot: CollectionSnapshot): string {
  const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const normalized = { ...snapshot, publication: snapshot.publication ?? defaultPublicationPolicy(), bookmarks: snapshot.bookmarks.map(bookmarkWithDefaults).sort(byId), tags: [...snapshot.tags].sort(byId) };
  return JSON.stringify(normalized, (_key, value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
}
