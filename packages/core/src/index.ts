export interface Bookmark {
  id: string;
  url: string;
  title: string;
  tagAssignments: Record<string, TagAssignment>;
  privateNote: string;
  evidence: { description: string; bodyExcerpt: string };
  ai: { includeBody: boolean; skip: boolean };
  fieldState: Record<string, ManualFieldState>;
}

export interface BookmarkEdit {
  url?: string;
  title?: string;
  privateNote?: string;
  description?: string;
  bodyExcerpt?: string;
  includeBody?: boolean;
  skipAi?: boolean;
}

// Additive defaults keep snapshots and device caches created by T01 readable.
export function bookmarkWithDefaults(bookmark: Pick<Bookmark, "id" | "url" | "title"> & Partial<Bookmark>): Bookmark {
  for (const state of Object.values(bookmark.fieldState ?? {})) {
    if (!Number.isSafeInteger(state.version) || state.version < 1) throw new Error("Field versions must be positive JavaScript-safe integers");
  }
  return { tagAssignments: {}, privateNote: "", evidence: { description: "", bodyExcerpt: "" }, ai: { includeBody: false, skip: false }, fieldState: {}, ...bookmark };
}

export function editBookmarkFields(bookmark: Bookmark, edit: BookmarkEdit): Bookmark {
  const updated = structuredClone(bookmark);
  function change<T extends object, K extends keyof T>(object: T, key: K, value: T[K] | undefined, path: string) {
    if (value !== undefined && object[key] !== value) {
      const version = nextManualVersion(updated.fieldState[path]?.version);
      object[key] = value;
      updated.fieldState[path] = { source: "manual", version, protected: true };
    }
  }
  change(updated, "url", edit.url === undefined ? undefined : normalizeBookmarkUrl(edit.url), "url");
  change(updated, "title", edit.title, "title");
  change(updated, "privateNote", edit.privateNote, "privateNote");
  change(updated.evidence, "description", edit.description, "evidence.description");
  change(updated.evidence, "bodyExcerpt", edit.bodyExcerpt, "evidence.bodyExcerpt");
  change(updated.ai, "includeBody", edit.includeBody, "ai.includeBody");
  change(updated.ai, "skip", edit.skipAi, "ai.skip");
  return updated;
}

export function aiEvidence(bookmark: Bookmark): { title: string; description: string; bodyExcerpt?: string } | null {
  if (bookmark.ai.skip) return null;
  return { title: bookmark.title, description: bookmark.evidence.description, ...(bookmark.ai.includeBody ? { bodyExcerpt: bookmark.evidence.bodyExcerpt } : {}) };
}

export interface CollectionSnapshot {
  schemaVersion: 1;
  bookmarks: Bookmark[];
  tags: Tag[];
}

export interface ManualFieldState {
  source: "manual";
  version: number;
  protected: boolean;
}

export interface TagAssignment extends ManualFieldState {
  state: "added" | "rejected";
}

export interface TaggingRules { inclusion: string; exclusion: string; examples: string }

export interface Tag {
  id: string;
  canonicalName: string;
  definition: string;
  rules: TaggingRules;
  fieldState: Record<string, ManualFieldState>;
}

export interface TagEdit { definition?: string; inclusion?: string; exclusion?: string; examples?: string }

function nextManualVersion(current?: number): number {
  if (current !== undefined && (!Number.isSafeInteger(current) || current <= 0 || current >= Number.MAX_SAFE_INTEGER)) {
    throw new Error("Manual version cannot be advanced safely");
  }
  return (current ?? 0) + 1;
}

export function canonicalTagName(input: string): string {
  const name = input.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
  if (!/[a-z]/i.test(name) || !/^[\x20-\x7e]+$/.test(name)) {
    throw new Error("Use an English canonical name containing a letter");
  }
  return name.toLowerCase();
}

export function createManualTag(id: string, name: string, definition: string, rules: Omit<TagEdit, "definition">): Tag {
  if (isBlankDefinition(definition)) throw new Error("A short English definition is required");
  const tag: Tag = { id, canonicalName: canonicalTagName(name), definition,
    rules: { inclusion: rules.inclusion ?? "", exclusion: rules.exclusion ?? "", examples: rules.examples ?? "" },
    fieldState: { canonicalName: { source: "manual", version: 1, protected: true }, definition: { source: "manual", version: 1, protected: true } } };
  for (const field of ["inclusion", "exclusion", "examples"] as const) {
    if (rules[field] !== undefined) tag.fieldState[`rules.${field}`] = { source: "manual", version: 1, protected: true };
  }
  return tag;
}

export function editManualTag(original: Tag, edit: TagEdit): Tag {
  if (edit.definition !== undefined && isBlankDefinition(edit.definition)) throw new Error("A short English definition is required");
  const tag = structuredClone(original);
  for (const field of ["definition", "inclusion", "exclusion", "examples"] as const) {
    const value = edit[field];
    const current = field === "definition" ? tag.definition : tag.rules[field];
    if (value === undefined || value === current) continue;
    const path = field === "definition" ? field : `rules.${field}`;
    if (field === "definition") tag.definition = value; else tag.rules[field] = value;
    tag.fieldState[path] = { source: "manual", version: nextManualVersion(tag.fieldState[path]?.version), protected: true };
  }
  return tag;
}

function isBlankDefinition(value: string): boolean {
  return /^[\p{White_Space}\uFEFF]*$/u.test(value);
}

export function setManualTagAssignment(original: Bookmark, tagId: string, state: TagAssignment["state"]): Bookmark {
  const existing = original.tagAssignments?.[tagId];
  if (existing?.state === state && existing.protected) return original;
  return { ...original, tagAssignments: { ...original.tagAssignments,
    [tagId]: { state, source: "manual", version: nextManualVersion(existing?.version), protected: true } } };
}

export interface SaveResult {
  bookmark: Bookmark;
  created: boolean;
}

export function normalizeBookmarkUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP(S) URLs can be saved");
  }
  if (url.username || url.password) throw new Error("URLs containing credentials cannot be saved");
  return url.href;
}
