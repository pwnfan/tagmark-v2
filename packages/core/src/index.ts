export interface Bookmark {
  id: string;
  url: string;
  title: string;
}

export interface CollectionSnapshot {
  schemaVersion: 1;
  bookmarks: Bookmark[];
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
  return url.href;
}
