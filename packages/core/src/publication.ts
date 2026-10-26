import { bookmarkWithDefaults, nextManualVersion, type Bookmark, type CollectionSnapshot, type ManualFieldState, type Tag } from "./index.ts";

export type PublicationMode = "manualOnly" | "includeAny" | "allMinusExcluded";
export type PublicationChoice = "followRules" | "manualPublic" | "manualPrivate";
export interface PublicationPolicy {
  mode: PublicationMode;
  includedTagIds: string[];
  excludedTagIds: string[];
  fieldState: Record<string, ManualFieldState>;
}
export interface PublicationDecision {
  bookmarkId: string;
  published: boolean;
  reason: "trash" | "excludedTag" | "manualPrivate" | "manualPublic" | "manualOnly" | "includedTag" | "noIncludedTag" | "allMinusExcluded";
  tagIds: string[];
}
export type PublicationEdit = Partial<Pick<PublicationPolicy, "mode" | "includedTagIds" | "excludedTagIds">>;

export function defaultPublicationPolicy(): PublicationPolicy {
  return { mode: "manualOnly", includedTagIds: [], excludedTagIds: [], fieldState: {} };
}

export function validatePublicationPolicy(policy: PublicationPolicy, tags: Tag[]): void {
  if (!["manualOnly", "includeAny", "allMinusExcluded"].includes(policy.mode)) throw new Error("Invalid publication mode");
  const known = new Set(tags.map((tag) => tag.id));
  for (const ids of [policy.includedTagIds, policy.excludedTagIds]) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !known.has(id))) throw new Error("Unknown publication tag; review the rule references");
    if (new Set(ids).size !== ids.length) throw new Error("Duplicate publication tag");
  }
  for (const [field, state] of Object.entries(policy.fieldState)) {
    if (!["mode", "includedTagIds", "excludedTagIds"].includes(field) || state.source !== "manual" || typeof state.protected !== "boolean"
      || !Number.isSafeInteger(state.version) || state.version < 1) throw new Error("Invalid publication field version");
  }
  for (const field of ["mode", "includedTagIds", "excludedTagIds"] as const) {
    if ((field === "mode" ? policy.mode !== "manualOnly" : policy[field].length > 0) && !policy.fieldState[field]) throw new Error("Publication rules require a field version");
  }
}

export function editPublicationPolicy(original: PublicationPolicy, edit: PublicationEdit, tags: Tag[]): PublicationPolicy {
  const policy = structuredClone(original);
  for (const field of ["mode", "includedTagIds", "excludedTagIds"] as const) {
    const value = edit[field];
    if (value === undefined) continue;
    if (field === "mode") policy.mode = edit.mode!;
    else policy[field] = [...new Set(edit[field]!)].sort();
    if (JSON.stringify(policy[field]) !== JSON.stringify(original[field])) {
      policy.fieldState[field] = { source: "manual", version: nextManualVersion(original.fieldState[field]?.version), protected: true };
    }
  }
  validatePublicationPolicy(policy, tags);
  return policy;
}

export function setPublicationChoice(bookmark: Bookmark, choice: PublicationChoice): Bookmark {
  if (!["followRules", "manualPublic", "manualPrivate"].includes(choice)) throw new Error("Invalid publication choice");
  if (bookmark.publicationChoice === choice) return bookmark;
  return { ...bookmark, publicationChoice: choice, fieldState: { ...bookmark.fieldState,
    publicationChoice: { source: "manual", version: nextManualVersion(bookmark.fieldState.publicationChoice?.version), protected: true } } };
}

export function previewPublication(snapshot: CollectionSnapshot, policy = snapshot.publication ?? defaultPublicationPolicy(), choices: Record<string, PublicationChoice> = {}) {
  validatePublicationPolicy(policy, snapshot.tags);
  const baseline = snapshot.publication ?? defaultPublicationPolicy();
  validatePublicationPolicy(baseline, snapshot.tags);
  const originals = snapshot.bookmarks.map(bookmarkWithDefaults);
  const bookmarks = originals.map((bookmark) => choices[bookmark.id] === undefined ? bookmark : setPublicationChoice(bookmark, choices[bookmark.id]!));
  for (const id of Object.keys(choices)) if (!bookmarks.some((bookmark) => bookmark.id === id)) throw new Error("Bookmark not found");
  for (const bookmark of bookmarks) {
    if (!["followRules", "manualPublic", "manualPrivate"].includes(bookmark.publicationChoice)) throw new Error("Invalid publication choice");
    for (const [id, assignment] of Object.entries(bookmark.tagAssignments)) {
      if (!snapshot.tags.some((tag) => tag.id === id) || !["added", "rejected"].includes(assignment.state) || assignment.source !== "manual"
        || typeof assignment.protected !== "boolean" || !Number.isSafeInteger(assignment.version) || assignment.version < 1) throw new Error("Invalid tag assignment reference or version");
    }
  }
  const decisions = publicationSelection(bookmarks, policy);
  const selectedIds = decisions.filter((decision) => decision.published).map((decision) => decision.bookmarkId);
  const previous = new Set(publicationSelection(originals, baseline).filter((decision) => decision.published).map((decision) => decision.bookmarkId));
  return { decisions, selectedIds, count: selectedIds.length, addedIds: selectedIds.filter((id) => !previous.has(id)),
    removedIds: [...previous].filter((id) => !selectedIds.includes(id)) };
}

export function exportPublicCollection(snapshot: CollectionSnapshot) {
  const selected = new Set(previewPublication(snapshot).selectedIds);
  const usedTags = new Set<string>();
  const bookmarks = snapshot.bookmarks.map(bookmarkWithDefaults).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).filter((bookmark) => selected.has(bookmark.id)).map((bookmark) => {
    const tagIds = Object.keys(bookmark.tagAssignments).filter((id) => bookmark.tagAssignments[id]?.state === "added").sort();
    tagIds.forEach((id) => usedTags.add(id));
    return { url: bookmark.url, title: bookmark.title, tagIds };
  });
  const tags = [...snapshot.tags].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).filter((tag) => usedTags.has(tag.id))
    .map((tag) => ({ id: tag.id, name: tag.canonicalName, definition: tag.definition }));
  return { schemaVersion: 1 as const, bookmarks, tags };
}

export function publicationSelection(bookmarks: Bookmark[], policy: PublicationPolicy): PublicationDecision[] {
  if (!["manualOnly", "includeAny", "allMinusExcluded"].includes(policy.mode)) throw new Error("Invalid publication mode");
  return [...bookmarks].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((bookmark) => {
    if (!["followRules", "manualPublic", "manualPrivate"].includes(bookmark.publicationChoice)) throw new Error("Invalid publication choice");
    const active = (ids: string[]) => ids.filter((id) => bookmark.tagAssignments[id]?.state === "added").sort();
    const excluded = active(policy.excludedTagIds);
    const included = active(policy.includedTagIds);
    const decision = (published: boolean, reason: PublicationDecision["reason"], tagIds: string[] = []): PublicationDecision =>
      ({ bookmarkId: bookmark.id, published, reason, tagIds });
    if (bookmark.deleted) return decision(false, "trash");
    if (excluded.length) return decision(false, "excludedTag", excluded);
    if (bookmark.publicationChoice === "manualPrivate") return decision(false, "manualPrivate");
    if (bookmark.publicationChoice === "manualPublic") return decision(true, "manualPublic");
    if (policy.mode === "manualOnly") return decision(false, "manualOnly");
    if (policy.mode === "includeAny") return included.length ? decision(true, "includedTag", included) : decision(false, "noIncludedTag");
    return decision(true, "allMinusExcluded");
  });
}
