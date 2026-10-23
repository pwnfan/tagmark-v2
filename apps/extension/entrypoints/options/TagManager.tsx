import { useId, useState } from "react";
import type { Tag, TagEdit } from "@tagmark/core";
import { createTag, editTag } from "../../lib/collection";

interface Props {
  tags: Tag[];
  onChange: () => Promise<void>;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}

const fieldLabels: Record<string, string> = {
  canonicalName: "Name", definition: "Definition", "rules.inclusion": "Inclusion",
  "rules.exclusion": "Exclusion", "rules.examples": "Examples",
};

function TagForm({ tag, onChange, onError, onStatus }: Omit<Props, "tags"> & { tag?: Tag }) {
  const formId = useId();
  const [name, setName] = useState("");
  // Refreshed props may include another manager's edits; submit only local user input.
  const [edit, setEdit] = useState<TagEdit>({});
  const definition = edit.definition ?? tag?.definition ?? "";
  const inclusion = edit.inclusion ?? tag?.rules.inclusion ?? "";
  const exclusion = edit.exclusion ?? tag?.rules.exclusion ?? "";
  const examples = edit.examples ?? tag?.rules.examples ?? "";
  const [saving, setSaving] = useState(false);
  function changeField(field: keyof TagEdit, value: string) {
    setEdit((current) => ({ ...current, [field]: value }));
  }
  return <form aria-label={tag ? `Edit tag ${tag.canonicalName}` : "Create tag"} onSubmit={async (event) => {
    event.preventDefault();
    setSaving(true); onError(""); onStatus("");
    try {
      if (tag) {
        await editTag(tag.id, edit);
      } else {
        await createTag(name, definition, {
          ...(inclusion ? { inclusion } : {}), ...(exclusion ? { exclusion } : {}), ...(examples ? { examples } : {}),
        });
      }
      await onChange();
      setEdit({});
      if (!tag) setName("");
      onStatus(tag ? "Tag changes saved. Changed fields are protected." : "Tag created on this device.");
    } catch (error) { onError(error instanceof Error ? error.message : "Tag could not be saved"); }
    finally { setSaving(false); }
  }}>
    {!tag && <><h3>Create tag</h3><label>English canonical name<input required disabled={saving} value={name} onChange={(event) => setName(event.target.value)} placeholder="machine-learning" /></label></>}
    <label htmlFor={`${formId}-definition`}>Short English definition</label>
    <textarea id={`${formId}-definition`} required disabled={saving} rows={2} value={definition} onChange={(event) => changeField("definition", event.target.value)} />
    <p>Tagging rules describe when this tag applies, independently of its definition.</p>
    <label htmlFor={`${formId}-inclusion`}>Inclusion</label>
    <textarea id={`${formId}-inclusion`} disabled={saving} rows={2} value={inclusion} onChange={(event) => changeField("inclusion", event.target.value)} />
    <label htmlFor={`${formId}-exclusion`}>Exclusion</label>
    <textarea id={`${formId}-exclusion`} disabled={saving} rows={2} value={exclusion} onChange={(event) => changeField("exclusion", event.target.value)} />
    <label htmlFor={`${formId}-examples`}>Examples</label>
    <textarea id={`${formId}-examples`} disabled={saving} rows={2} value={examples} onChange={(event) => changeField("examples", event.target.value)} />
    {tag && <p className="protection">Protected fields: {Object.keys(fieldLabels).filter((field) => tag.fieldState[field]?.protected).map((field) => fieldLabels[field]).join(", ") || "None"}</p>}
    <button disabled={saving} type="submit">{tag ? "Save tag changes" : "Create tag"}</button>
  </form>;
}

export function TagManager({ tags, ...handlers }: Props) {
  return <section aria-label="Tags">
    <div className="section-heading"><h2>Tags · {tags.length}</h2></div>
    <p>Use English names and short definitions. Each changed field is protected separately.</p>
    <TagForm {...handlers} />
    {tags.map((tag) => <fieldset className="tag-editor" key={tag.id} aria-label={`Tag ${tag.canonicalName}`}>
      <legend>{tag.canonicalName}</legend>
      <TagForm tag={tag} {...handlers} />
    </fieldset>)}
  </section>;
}
