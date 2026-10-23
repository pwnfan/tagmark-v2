import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import { normalizeBookmarkUrl, type SaveResult } from "@tagmark/core";
import { saveBookmark } from "../../lib/collection";
import "../../style.css";

function SavePage() {
  const [page, setPage] = useState<{ url: string; title: string }>();
  const [result, setResult] = useState<SaveResult>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.url) throw new Error("This page is unavailable. Open an HTTP(S) page to save it.");
      setPage({ url: normalizeBookmarkUrl(tab.url), title: tab.title ?? tab.url });
    }).catch((error: unknown) => setError(error instanceof Error ? error.message : "This page is unavailable"));
  }, []);

  return <main>
    <header><span className="brand">TagMark</span></header>
    <h1>Save this page</h1>
    {page && <><h2>{page.title}</h2><p className="url">{page.url}</p></>}
    {error && <p role="alert">{error}</p>}
    <button disabled={!page || saving} onClick={async () => {
      if (!page) return;
      setSaving(true);
      setError("");
      try {
        setResult(await saveBookmark(page.url, page.title));
      } catch (error) {
        setError(error instanceof Error ? error.message : "Bookmark could not be saved");
      } finally {
        setSaving(false);
      }
    }}>{saving ? "Saving…" : "Save bookmark"}</button>
    <p role="status">{result && (result.created ? "Bookmark saved on this device." : "Already saved. Your original bookmark is kept.")}</p>
    {result && <article><strong>{result.bookmark.title}</strong><p className="url">{result.bookmark.url}</p></article>}
    <a href={browser.runtime.getURL(`/options.html${result ? `#bookmark-${result.bookmark.id}` : ""}`)} target="_blank" rel="noreferrer">
      {result ? "View saved bookmark" : "Open my collection"}
    </a>
  </main>;
}

createRoot(document.getElementById("root")!).render(<SavePage />);
