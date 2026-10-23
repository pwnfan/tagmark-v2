import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Bookmark, Tag } from "@tagmark/core";
import { collectionSnapshot, listBookmarks, listTags, saveBookmark } from "../../lib/collection";
import { TagManager } from "./TagManager";
import { BookmarkTags } from "./BookmarkTags";
import { BookmarkEditor } from "../../lib/BookmarkEditor";
import "../../style.css";

function Collection() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState("");
  const [selected, setSelected] = useState(() => location.hash.startsWith("#bookmark-") ? location.hash.slice("#bookmark-".length) : "");

  useEffect(() => {
    collectionSnapshot().then((snapshot) => { setBookmarks(snapshot.bookmarks); setTags(snapshot.tags); }).catch((error: unknown) => setError(String(error)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selected) document.getElementById(`bookmark-${selected}`)?.focus();
  }, [selected, bookmarks]);

  return <main>
    <header><span className="brand">TagMark</span><span className="badge">Saved on this device</span></header>
    <h1>My bookmarks</h1>
    <p className="intro">Keep something worth coming back to. You can save while offline.</p>
    <form onSubmit={async (event) => {
      event.preventDefault();
      setSaving(true);
      setError("");
      setStatus("");
      try {
        const result = await saveBookmark(url, title);
        setBookmarks(await listBookmarks());
        setSelected(result.bookmark.id);
        setStatus(result.created ? "Bookmark saved on this device." : "Already saved. Your original bookmark is kept.");
      } catch (error) {
        setError(error instanceof Error ? error.message : "Bookmark could not be saved");
      } finally {
        setSaving(false);
      }
    }}>
      <h2>Save a bookmark</h2>
      <label>URL<input type="text" inputMode="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" /></label>
      <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What would you like to call it?" /></label>
      <button disabled={saving} type="submit">{saving ? "Saving…" : "Save bookmark"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <p role="status">{status}</p>
    <section aria-label="Saved bookmarks">
      <div className="section-heading"><h2>Saved bookmarks · {bookmarks.length}</h2>
        <button className="secondary" disabled={loading} onClick={async () => {
          setError("");
          try {
            const snapshot = await collectionSnapshot();
            const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2) + "\n"], { type: "application/json" }));
            const download = document.createElement("a");
            download.href = url;
            download.download = "collection.json";
            download.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (error) {
            setError(error instanceof Error ? error.message : "Snapshot could not be downloaded");
          }
        }}>Download local snapshot</button>
      </div>
      {loading ? <p>Loading bookmarks…</p> : bookmarks.length === 0 ? <p className="empty">Your collection starts with one URL.</p> :
        bookmarks.map((bookmark) => <article key={bookmark.id} id={`bookmark-${bookmark.id}`} tabIndex={-1}>
          <a href={bookmark.url} target="_blank" rel="noreferrer">{bookmark.title}</a>
          <p className="url">{bookmark.url}</p>
          <BookmarkTags bookmark={bookmark} tags={tags} onChange={async () => setBookmarks(await listBookmarks())} onError={setError} onStatus={setStatus} />
          {editing === bookmark.id ? <BookmarkEditor bookmark={bookmark} onCancel={() => setEditing("")} onSaved={async () => {
            setBookmarks(await listBookmarks());
            setEditing("");
            setSelected(bookmark.id);
            setStatus("Bookmark changes saved on this device.");
          }} /> : <button className="secondary" onClick={() => setEditing(bookmark.id)}>Edit bookmark</button>}
        </article>)}
    </section>
    <TagManager tags={tags} onChange={async () => setTags(await listTags())} onError={setError} onStatus={setStatus} />
  </main>;
}

createRoot(document.getElementById("root")!).render(<Collection />);
