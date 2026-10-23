import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import { normalizeBookmarkUrl, type SaveResult } from "@tagmark/core";
import { saveBookmark } from "../../lib/collection";
import "../../style.css";

function SavePage() {
  const [page, setPage] = useState<{ tabId: number; url: string; title: string }>();
  const [includeBody, setIncludeBody] = useState(false);
  const [skipAi, setSkipAi] = useState(false);
  const [result, setResult] = useState<SaveResult>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.url || tab.id === undefined) throw new Error("This page is unavailable. Open an HTTP(S) page to save it.");
      setPage({ tabId: tab.id, url: normalizeBookmarkUrl(tab.url), title: tab.title ?? tab.url });
    }).catch((error: unknown) => setError(error instanceof Error ? error.message : "This page is unavailable"));
  }, []);

  return <main>
    <header><span className="brand">TagMark</span></header>
    <h1>Save this page</h1>
    {page && <><h2>{page.title}</h2><p className="url">{page.url}</p></>}
    {error && <p role="alert">{error}</p>}
    <p>Save the page title and description. Body text is optional; you can review or edit it in your collection.</p>
    <label><input type="checkbox" checked={includeBody} onChange={(event) => setIncludeBody(event.target.checked)} />Allow body excerpt for AI</label>
    <label><input type="checkbox" checked={skipAi} onChange={(event) => setSkipAi(event.target.checked)} />Skip AI for this bookmark</label>
    <button disabled={!page || saving} onClick={async () => {
      if (!page) return;
      setSaving(true);
      setError("");
      try {
        let evidence = { description: "", bodyExcerpt: "" };
        let capturedUrl = page.url;
        try {
          const [capture] = await browser.scripting.executeScript({
            target: { tabId: page.tabId },
            args: [includeBody],
            func: (allowBody: boolean) => {
              const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content.slice(0, 2000) ?? "";
              const parts: string[] = [];
              let length = 0;
              if (allowBody && document.body) {
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                while (walker.nextNode() && length < 20000) {
                  const node = walker.currentNode;
                  let element = node.parentElement;
                  let allowed = true;
                  while (element) {
                    const style = getComputedStyle(element);
                    if (element.matches('script,style,noscript,template,form,input,textarea,select,button,iframe,[contenteditable],[hidden],[aria-hidden="true"]') || style.display === "none" || style.visibility !== "visible") { allowed = false; break; }
                    element = element.parentElement;
                  }
                  const text = node.textContent?.trim();
                  if (allowed && text) { parts.push(text); length += text.length + 1; }
                }
              }
              return { url: location.href, description, bodyExcerpt: parts.join("\n").slice(0, 20000) };
            },
          });
          if (capture?.result) {
            capturedUrl = capture.result.url;
            evidence = { description: capture.result.description, bodyExcerpt: capture.result.bodyExcerpt };
          }
        } catch {
          setError("Page evidence could not be read. Saving the URL and title only.");
        }
        if (normalizeBookmarkUrl(capturedUrl) !== page.url) throw new Error("The page changed. Reopen TagMark before saving.");
        setResult(await saveBookmark(page.url, page.title, { evidence, ai: { includeBody, skip: skipAi } }));
      } catch (error) {
        setError(error instanceof Error ? error.message : "Bookmark could not be saved");
      } finally {
        setSaving(false);
      }
    }}>{saving ? "Saving…" : "Save bookmark"}</button>
    <p role="status">{result && (result.bookmark.deleted ? "In Trash. Open the bookmark to restore it explicitly." : result.created ? "Bookmark saved on this device." : "Already saved. Your original bookmark is kept.")}</p>
    {result && <article><strong>{result.bookmark.title}</strong><p className="url">{result.bookmark.url}</p></article>}
    <a href={browser.runtime.getURL(`/options.html${result ? `#bookmark-${result.bookmark.id}` : ""}`)} target="_blank" rel="noreferrer">
      {result?.bookmark.deleted ? "View bookmark in Trash" : result ? "View saved bookmark" : "Open my collection"}
    </a>
  </main>;
}

createRoot(document.getElementById("root")!).render(<SavePage />);
