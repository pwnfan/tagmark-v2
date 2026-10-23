import { createManualTag, editManualTag, normalizeBookmarkUrl, setManualTagAssignment,
  type Bookmark, type CollectionSnapshot, type SaveResult, type Tag, type TagAssignment, type TagEdit } from "@tagmark/core";

const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("tagmark", 2);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains("bookmarks")) {
      const bookmarks = request.result.createObjectStore("bookmarks", { keyPath: "id" });
      bookmarks.createIndex("url", "url", { unique: true });
    }
    const tags = request.result.createObjectStore("tags", { keyPath: "id" });
    tags.createIndex("canonicalName", "canonicalName", { unique: true });
  };
  request.onsuccess = () => {
    request.result.onversionchange = () => request.result.close();
    resolve(request.result);
  };
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error("Close other TagMark pages, then try again"));
});

export async function listBookmarks(): Promise<Bookmark[]> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const request = db.transaction("bookmarks").objectStore("bookmarks").getAll();
    request.onsuccess = () => resolve((request.result as Bookmark[]).map((bookmark) => ({ ...bookmark, tagAssignments: bookmark.tagAssignments ?? {} })));
    request.onerror = () => reject(request.error);
  });
}

export async function saveBookmark(inputUrl: string, title: string): Promise<SaveResult> {
  const url = normalizeBookmarkUrl(inputUrl);
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("bookmarks", "readwrite");
    const bookmarks = transaction.objectStore("bookmarks");
    let result: SaveResult;
    const existing = bookmarks.index("url").get(url);
    existing.onsuccess = () => {
      if (existing.result) {
        const bookmark = existing.result as Bookmark;
        result = { bookmark: { ...bookmark, tagAssignments: bookmark.tagAssignments ?? {} }, created: false };
      } else {
        const bookmark = { id: crypto.randomUUID(), url, title: title.trim() ? title : url, tagAssignments: {} };
        bookmarks.add(bookmark);
        result = { bookmark, created: true };
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error ?? new Error("Bookmark was not saved"));
    transaction.onerror = () => reject(transaction.error ?? new Error("Bookmark was not saved"));
  });
}

export async function listTags(): Promise<Tag[]> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const request = db.transaction("tags").objectStore("tags").getAll();
    request.onsuccess = () => resolve(request.result as Tag[]);
    request.onerror = () => reject(request.error);
  });
}

export async function createTag(name: string, definition: string, rules: Omit<TagEdit, "definition">): Promise<Tag> {
  const tag = createManualTag(crypto.randomUUID(), name, definition, rules);
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("tags", "readwrite");
    transaction.objectStore("tags").add(tag);
    transaction.oncomplete = () => resolve(tag);
    transaction.onabort = () => reject(transaction.error?.name === "ConstraintError"
      ? new Error(`Tag '${tag.canonicalName}' already exists`) : transaction.error ?? new Error("Tag was not saved"));
  });
}

export async function editTag(id: string, edit: TagEdit): Promise<Tag> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("tags", "readwrite");
    const store = transaction.objectStore("tags");
    let result: Tag;
    let error: unknown;
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        if (!request.result) throw new Error("Tag not found");
        result = editManualTag(request.result as Tag, edit);
        store.put(result);
      } catch (caught) { error = caught; transaction.abort(); }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(error ?? transaction.error ?? new Error("Tag was not saved"));
  });
}

export async function assignTag(bookmarkId: string, tagId: string, state: TagAssignment["state"]): Promise<Bookmark> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["bookmarks", "tags"], "readwrite");
    const bookmarks = transaction.objectStore("bookmarks");
    let result: Bookmark;
    let error: unknown;
    const tag = transaction.objectStore("tags").get(tagId);
    tag.onsuccess = () => {
      if (!tag.result) { error = new Error("Tag not found"); transaction.abort(); return; }
      const request = bookmarks.get(bookmarkId);
      request.onsuccess = () => {
        if (!request.result) { error = new Error("Bookmark not found"); transaction.abort(); return; }
        result = setManualTagAssignment(request.result as Bookmark, tagId, state);
        bookmarks.put(result);
      };
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(error ?? transaction.error ?? new Error("Tag decision was not saved"));
  });
}

export async function collectionSnapshot(): Promise<CollectionSnapshot> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["bookmarks", "tags"]);
    const bookmarks = transaction.objectStore("bookmarks").getAll();
    const tags = transaction.objectStore("tags").getAll();
    transaction.oncomplete = () => resolve({ schemaVersion: 1,
      bookmarks: (bookmarks.result as Bookmark[]).map((bookmark) => ({ ...bookmark, tagAssignments: bookmark.tagAssignments ?? {} })),
      tags: tags.result as Tag[] });
    transaction.onabort = () => reject(transaction.error ?? new Error("Snapshot could not be read"));
  });
}
