import { useEffect, useState } from "react";
import { defaultPublicationPolicy, editPublicationPolicy, previewPublication, publicationSelection,
  type Bookmark, type CollectionSnapshot, type PublicationChoice, type PublicationDecision, type PublicationEdit, type PublicationMode, type Tag } from "@tagmark/core";
import { collectionSnapshot, savePublication } from "../../lib/collection";

function reasonText(decision: PublicationDecision, tags: Tag[]): string {
  const names = decision.tagIds.map((id) => tags.find((tag) => tag.id === id)?.canonicalName ?? id).join(", ");
  switch (decision.reason) {
    case "trash": return "In Trash";
    case "excludedTag": return `Blocked by excluded tag: ${names}`;
    case "manualPrivate": return "Manually private";
    case "manualPublic": return "Manually public";
    case "manualOnly": return "Manual-only mode; follows rules";
    case "includedTag": return `Included tag: ${names}`;
    case "noIncludedTag": return "No included tag matches";
    case "allMinusExcluded": return "All minus excluded tags";
  }
}

export function PublicationManager({ bookmarks, tags, onSaved, onError, onStatus }: {
  bookmarks: Bookmark[]; tags: Tag[]; onSaved: () => Promise<void>; onError: (error: string) => void; onStatus: (status: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<CollectionSnapshot>({ schemaVersion: 1, bookmarks: [], tags: [] });
  const [edit, setEdit] = useState<PublicationEdit>({});
  const [choices, setChoices] = useState<Record<string, PublicationChoice>>({});
  const [preview, setPreview] = useState<{ snapshot: CollectionSnapshot; result: ReturnType<typeof previewPublication> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setLoaded(false);
    collectionSnapshot().then((current) => { if (!cancelled) { setSnapshot(current); setLoaded(true); } })
      .catch((error: unknown) => { if (!cancelled) onError(String(error)); });
    return () => { cancelled = true; };
  }, [bookmarks, tags, onError]);
  const policy = { ...(snapshot.publication ?? defaultPublicationPolicy()), ...edit };
  function change(update: PublicationEdit) { setEdit({ ...edit, ...update }); setPreview(null); }
  function toggle(field: "includedTagIds" | "excludedTagIds", id: string, checked: boolean) {
    change({ [field]: checked ? [...policy[field], id] : policy[field].filter((candidate) => candidate !== id) });
  }
  return <section aria-label="Publication selection" className="publication">
    <div className="section-heading"><h2>Publication selection</h2><span>Desired selection</span></div>
    {loaded && <p>Saved desired selection: {publicationSelection(snapshot.bookmarks, snapshot.publication ?? defaultPublicationPolicy()).filter((decision) => decision.published).length}</p>}
    <p>Choose what may be shared. These choices do not deploy a website or confirm that a previous publication has been withdrawn.</p>
    <fieldset disabled={busy || !loaded}>
      <legend>Public rules and individual choices</legend>
      <label>Base mode<select aria-label="Base mode" value={policy.mode} onChange={(event) => change({ mode: event.target.value as PublicationMode })}>
        <option value="manualOnly">Only manually public bookmarks (default)</option>
        <option value="includeAny">Any included tag, minus excluded tags</option>
        <option value="allMinusExcluded">All bookmarks, minus excluded tags</option>
      </select></label>
      <p className="publication-notice">Tag rules automatically recalculate the selection when new bookmarks arrive or AI or manual tag assignments change. No additional approval is requested for each change. Updates reach a website only after a successful deployment.</p>
      <p>Excluded tags always block publication, including manually public bookmarks. Other tags are neutral. An empty include list selects no bookmarks through the include rule.</p>
      <div className="publication-tags">
        <fieldset><legend>Included tags (any)</legend>{snapshot.tags.length ? snapshot.tags.map((tag) =>
          <label key={tag.id}><input type="checkbox" aria-label={`Include ${tag.canonicalName}`} checked={policy.includedTagIds.includes(tag.id)} onChange={(event) => toggle("includedTagIds", tag.id, event.target.checked)} />{tag.canonicalName}</label>) : <p>No tags yet.</p>}</fieldset>
        <fieldset><legend>Excluded tags (veto)</legend>{snapshot.tags.length ? snapshot.tags.map((tag) =>
          <label key={tag.id}><input type="checkbox" aria-label={`Exclude ${tag.canonicalName}`} checked={policy.excludedTagIds.includes(tag.id)} onChange={(event) => toggle("excludedTagIds", tag.id, event.target.checked)} />{tag.canonicalName}</label>) : <p>No tags yet.</p>}</fieldset>
      </div>
      {snapshot.bookmarks.map((bookmark) => <label key={bookmark.id}>{bookmark.title}{bookmark.deleted ? " · In Trash" : ""}
        <select aria-label={`Publication choice for ${bookmark.title}`} value={choices[bookmark.id] ?? bookmark.publicationChoice} onChange={(event) => {
          setChoices({ ...choices, [bookmark.id]: event.target.value as PublicationChoice }); setPreview(null);
        }}>
          <option value="followRules">Follow rules</option><option value="manualPublic">Manually public</option><option value="manualPrivate">Manually private</option>
        </select>
      </label>)}
      <button type="button" onClick={async () => {
        setBusy(true); onError(""); onStatus("");
        try {
          const current = await collectionSnapshot();
          const candidate = editPublicationPolicy(current.publication ?? defaultPublicationPolicy(), edit, current.tags);
          setSnapshot(current); setPreview({ snapshot: current, result: previewPublication(current, candidate, choices) });
        } catch (error) { setPreview(null); onError(error instanceof Error ? error.message : "Preview could not be calculated"); }
        finally { setBusy(false); }
      }}>Preview changes</button>
    </fieldset>
    {preview && <div className="publication-preview" aria-label="Publication preview">
      <h3>Before saving</h3>
      <p>Selected: {preview.result.count} · Added: {preview.result.addedIds.length} · Removed: {preview.result.removedIds.length}</p>
      <p>Changes are compared with the saved desired selection, not a deployed website.</p>
      <ul>{preview.result.decisions.map((decision) => <li key={decision.bookmarkId}>
        <strong>{preview.snapshot.bookmarks.find((bookmark) => bookmark.id === decision.bookmarkId)?.title}</strong>
        {" — "}{decision.published ? "Public" : "Private"}{" · "}{reasonText(decision, preview.snapshot.tags)}
        {preview.result.addedIds.includes(decision.bookmarkId) ? " · Added" : preview.result.removedIds.includes(decision.bookmarkId) ? " · Removed" : ""}
      </li>)}</ul>
      <button type="button" disabled={busy} onClick={async () => {
        setBusy(true); onError(""); onStatus("");
        try {
          await savePublication(edit, choices, preview.snapshot);
          setEdit({}); setChoices({}); setPreview(null);
          setSnapshot(await collectionSnapshot()); await onSaved();
          onStatus("Publication choices saved on this device. This does not confirm a website deployment.");
        } catch (error) { setPreview(null); onError(error instanceof Error ? error.message : "Publication choices were not saved"); }
        finally { setBusy(false); }
      }}>Save publication choices</button>
    </div>}
  </section>;
}
