import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Bookmark, Tag } from "@tagmark/core";
import { changeBookmarkDeletion, collectionSnapshot, listBookmarks, listTags, saveBookmark } from "../../lib/collection";
import { TagManager } from "./TagManager";
import { BookmarkTags } from "./BookmarkTags";
import { PublicationManager } from "./PublicationManager";
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
  const [trash, setTrash] = useState(false);
  const [selected, setSelected] = useState(() => location.hash.startsWith("#bookmark-") ? location.hash.slice("#bookmark-".length) : "");

  useEffect(() => {
    const selectFromHash = () => setSelected(location.hash.startsWith("#bookmark-") ? location.hash.slice("#bookmark-".length) : "");
    window.addEventListener("hashchange", selectFromHash);
    return () => window.removeEventListener("hashchange", selectFromHash);
  }, []);

  useEffect(() => {
    collectionSnapshot().then((snapshot) => {
      setBookmarks(snapshot.bookmarks); setTags(snapshot.tags);
      const bookmark = snapshot.bookmarks.find((bookmark) => bookmark.id === selected);
      if (bookmark) setTrash(bookmark.deleted);
    }).catch((error: unknown) => setError(String(error)))
      .finally(() => setLoading(false));
  }, [selected]);

  useEffect(() => {
    if (selected) document.getElementById(`bookmark-${selected}`)?.focus();
  }, [selected, bookmarks, trash]);

  const visibleBookmarks = bookmarks.filter((bookmark) => bookmark.deleted === trash);

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
        setTrash(result.bookmark.deleted);
        setStatus(result.bookmark.deleted ? "In Trash. Restore this bookmark explicitly to return it to Saved bookmarks." : result.created ? "Bookmark saved on this device." : "Already saved. Your original bookmark is kept.");
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
    <nav aria-label="Collection views">
      <button className="secondary" aria-pressed={!trash} onClick={() => setTrash(false)}>Saved bookmarks</button>
      <button className="secondary" aria-pressed={trash} onClick={() => setTrash(true)}>Trash</button>
    </nav>
    <section aria-label={trash ? "Trash" : "Saved bookmarks"}>
      <div className="section-heading"><h2>{trash ? "Trash" : "Saved bookmarks"} · {visibleBookmarks.length}</h2>
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
      {trash && <p>Deleted bookmarks keep their content here until you restore them. Trash is never automatically emptied.</p>}
      {loading ? <p>Loading bookmarks…</p> : visibleBookmarks.length === 0 ? <p className="empty">{trash ? "Trash is empty." : "Your collection starts with one URL."}</p> :
        visibleBookmarks.map((bookmark) => <article key={bookmark.id} id={`bookmark-${bookmark.id}`} tabIndex={-1}>
          <a href={bookmark.url} target="_blank" rel="noreferrer">{bookmark.title}</a>
          <p className="url">{bookmark.url}</p>
          <button className="secondary" disabled={saving} onClick={async () => {
            setSaving(true);
            setError("");
            try {
              await changeBookmarkDeletion(bookmark.id, !trash);
              setBookmarks(await listBookmarks());
              setStatus(trash ? "Bookmark restored to Saved bookmarks." : "Bookmark moved to Trash. Its content is kept.");
            } catch (error) {
              setError(error instanceof Error ? error.message : "Bookmark could not be updated");
            } finally {
              setSaving(false);
            }
          }}>{trash ? "Restore bookmark" : "Move to Trash"}</button>
          <BookmarkTags bookmark={bookmark} tags={tags} onChange={async () => setBookmarks(await listBookmarks())} onError={setError} onStatus={setStatus} />
          {editing === bookmark.id ? <BookmarkEditor bookmark={bookmark} onCancel={() => setEditing("")} onSaved={async () => {
            setBookmarks(await listBookmarks());
            setEditing("");
            setSelected(bookmark.id);
            setStatus("Bookmark changes saved on this device.");
          }} /> : <button className="secondary" onClick={() => setEditing(bookmark.id)}>Edit bookmark</button>}
        </article>)}
    </section>
    <PublicationManager bookmarks={bookmarks} tags={tags} onSaved={async () => {
      const snapshot = await collectionSnapshot(); setBookmarks(snapshot.bookmarks); setTags(snapshot.tags);
    }} onError={setError} onStatus={setStatus} />
    <TagManager tags={tags} onChange={async () => setTags(await listTags())} onError={setError} onStatus={setStatus} />
  </main>;
}

createRoot(document.getElementById("root")!).render(<Collection />);
