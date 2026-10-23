import { useId, useState } from "react";
import { aiEvidence, type Bookmark, type BookmarkEdit } from "@tagmark/core";
import { editBookmark } from "./collection";

export function BookmarkEditor({ bookmark, onSaved, onCancel }: { bookmark: Bookmark; onSaved: () => Promise<void>; onCancel: () => void }) {
  const formId = useId();
  // Refreshed records update untouched fields without replacing unsaved user input.
  const [edit, setEdit] = useState<BookmarkEdit>({});
  const draft: Bookmark = {
    ...bookmark,
    title: edit.title ?? bookmark.title,
    url: edit.url ?? bookmark.url,
    privateNote: edit.privateNote ?? bookmark.privateNote,
    evidence: { description: edit.description ?? bookmark.evidence.description, bodyExcerpt: edit.bodyExcerpt ?? bookmark.evidence.bodyExcerpt },
    ai: { includeBody: edit.includeBody ?? bookmark.ai.includeBody, skip: edit.skipAi ?? bookmark.ai.skip },
  };
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return <form aria-label="Edit bookmark" onSubmit={async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await editBookmark(bookmark.id, edit);
      await onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Bookmark could not be edited");
    } finally { setSaving(false); }
  }}>
    <h2>Edit bookmark</h2>
    <label>Title<input disabled={saving} value={draft.title} onChange={(event) => setEdit((current) => ({ ...current, title: event.target.value }))} /></label>
    <label>URL<input disabled={saving} required inputMode="url" value={draft.url} onChange={(event) => setEdit((current) => ({ ...current, url: event.target.value }))} /></label>
    <label htmlFor={`${formId}-note`}>Private note</label><textarea disabled={saving} id={`${formId}-note`} value={draft.privateNote} onChange={(event) => setEdit((current) => ({ ...current, privateNote: event.target.value }))} />
    <p>Private notes are never included in AI input.</p>
    <label htmlFor={`${formId}-description`}>Page description</label><textarea disabled={saving} id={`${formId}-description`} value={draft.evidence.description} onChange={(event) => setEdit((current) => ({ ...current, description: event.target.value }))} />
    <label htmlFor={`${formId}-body`}>Body excerpt</label><textarea disabled={saving} id={`${formId}-body`} value={draft.evidence.bodyExcerpt} onChange={(event) => setEdit((current) => ({ ...current, bodyExcerpt: event.target.value }))} />
    <label><input disabled={saving} type="checkbox" checked={draft.ai.includeBody} onChange={(event) => setEdit((current) => ({ ...current, includeBody: event.target.checked }))} />Allow body excerpt for AI</label>
    <label><input disabled={saving} type="checkbox" checked={draft.ai.skip} onChange={(event) => setEdit((current) => ({ ...current, skipAi: event.target.checked }))} />Skip AI for this bookmark</label>
    <details><summary>Preview allowed AI evidence</summary><pre>{JSON.stringify(aiEvidence(draft), null, 2)}</pre><p>Preview only. No model request is sent.</p></details>
    {error && <p role="alert">{error}</p>}
    <div className="actions"><button disabled={saving} type="submit">Save changes</button><button disabled={saving} type="button" className="secondary" onClick={onCancel}>Cancel</button></div>
  </form>;
}
