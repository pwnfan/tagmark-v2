import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Bookmark, CollectionSnapshot } from "@tagmark/core";
import { listBookmarks, saveBookmark } from "../../lib/collection";
import "../../style.css";

function Collection() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => location.hash.startsWith("#bookmark-") ? location.hash.slice("#bookmark-".length) : "");

  useEffect(() => {
    listBookmarks().then(setBookmarks).catch((error: unknown) => setError(String(error)))
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
            const snapshot: CollectionSnapshot = { schemaVersion: 1, bookmarks: await listBookmarks() };
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
        </article>)}
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Collection />);
