import { normalizeBookmarkUrl, type Bookmark, type SaveResult } from "@tagmark/core";

const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("tagmark", 1);
  request.onupgradeneeded = () => {
    const bookmarks = request.result.createObjectStore("bookmarks", { keyPath: "id" });
    bookmarks.createIndex("url", "url", { unique: true });
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
    request.onsuccess = () => resolve(request.result as Bookmark[]);
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
        result = { bookmark: existing.result as Bookmark, created: false };
      } else {
        const bookmark = { id: crypto.randomUUID(), url, title: title.trim() ? title : url };
        bookmarks.add(bookmark);
        result = { bookmark, created: true };
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error ?? new Error("Bookmark was not saved"));
    transaction.onerror = () => reject(transaction.error ?? new Error("Bookmark was not saved"));
  });
}
