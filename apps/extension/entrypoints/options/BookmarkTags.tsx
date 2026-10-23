import { useId, useState } from "react";
import type { Bookmark, Tag, TagAssignment } from "@tagmark/core";
import { assignTag } from "../../lib/collection";

export function BookmarkTags({ bookmark, tags, onChange, onError, onStatus }: {
  bookmark: Bookmark;
  tags: Tag[];
  onChange: () => Promise<void>;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const selectId = useId();
  const [tagId, setTagId] = useState("");
  const [saving, setSaving] = useState(false);
  async function decide(state: TagAssignment["state"]) {
    setSaving(true); onError(""); onStatus("");
    try {
      await assignTag(bookmark.id, tagId, state);
      await onChange();
      onStatus(state === "added" ? "Tag added and protected." : "Tag rejected and protected.");
    } catch (error) { onError(error instanceof Error ? error.message : "Tag decision could not be saved"); }
    finally { setSaving(false); }
  }
  return <div className="bookmark-tags">
    {Object.entries(bookmark.tagAssignments ?? {}).length > 0 && <ul>
      {Object.entries(bookmark.tagAssignments ?? {}).map(([id, assignment]) => <li key={id}>
        {tags.find((tag) => tag.id === id)?.canonicalName ?? id} — {assignment.state}{assignment.protected ? " · protected" : ""}
      </li>)}
    </ul>}
    {tags.length > 0 && <>
      <label htmlFor={selectId}>Choose tag</label>
      <select id={selectId} value={tagId} onChange={(event) => setTagId(event.target.value)}>
        <option value="">Select a tag</option>
        {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.canonicalName}</option>)}
      </select>
      <div className="tag-actions">
        <button className="secondary" disabled={!tagId || saving} onClick={() => void decide("added")}>Add tag</button>
        <button className="secondary" disabled={!tagId || saving} onClick={() => void decide("rejected")}>Reject tag</button>
      </div>
    </>}
  </div>;
}
