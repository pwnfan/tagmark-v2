import { useEffect, useState } from "react";
import { forgetCredential, isSynced, readSyncSettings, saveSyncSettings, syncCollection } from "../../lib/sync";

export function SyncPanel({ onSynced }: { onSynced: () => Promise<void> }) {
  const [repository, setRepository] = useState("");
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Unsynced");
  const [error, setError] = useState("");
  useEffect(() => {
    readSyncSettings().then((settings) => { if (settings) { setRepository(settings.repository); setRemember(settings.remember); } }).catch(() => setError("Sync settings could not be read"));
    isSynced().then((clean) => setStatus(clean ? "Success — synchronized snapshot" : "Unsynced — local changes are kept")).catch(() => setError("Sync state could not be read"));
  }, []);
  useEffect(() => {
    const refresh = () => { if (!busy) isSynced().then((clean) => setStatus(navigator.onLine ? clean ? "Success — synchronized snapshot" : "Unsynced — local changes are kept" : "Offline — local changes are kept")).catch(() => setError("Sync state could not be read")); };
    window.addEventListener("tagmark-changed", refresh); window.addEventListener("online", refresh); window.addEventListener("offline", refresh);
    return () => { window.removeEventListener("tagmark-changed", refresh); window.removeEventListener("online", refresh); window.removeEventListener("offline", refresh); };
  }, [busy]);
  return <section aria-label="Private repository sync">
    <h2>Private repository sync</h2>
    <p>Use a private GitHub repository initialized with a README and a token restricted to its Contents read/write permission. Sync does not publish a website.</p>
    <form onSubmit={async (event) => {
      event.preventDefault(); setError("");
      try { await saveSyncSettings({ repository: repository.trim(), remember }, token); setToken(""); setStatus("Unsynced — settings saved"); }
      catch (error) { setError(error instanceof Error ? error.message : "Settings could not be saved"); }
    }}>
      <label>Repository<input required disabled={busy} value={repository} placeholder="owner/repository" onChange={(event) => setRepository(event.target.value)} /></label>
      <label>GitHub token<input required disabled={busy} type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} /></label>
      <label><input disabled={busy} type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />Remember credential on this device</label>
      <p>{remember ? "Stored in this Chrome profile until forgotten. TagMark does not encrypt this local storage." : "Session only. Chrome clears the credential when the browser closes."}</p>
      <button disabled={busy} type="submit">Save sync settings</button>
    </form>
    <button disabled={busy} onClick={async () => {
      setBusy(true); setError(""); setStatus("Syncing…");
      try { const clean = await syncCollection(); setStatus(clean ? "Success — synchronized snapshot" : "Unsynced — newer local changes are kept"); await onSynced(); }
      catch (error) { setStatus("Failure — local changes are kept"); setError(error instanceof Error ? error.message : "Sync failed"); }
      finally { setBusy(false); }
    }}>{busy ? "Syncing…" : "Sync now"}</button>
    <button className="secondary" disabled={busy} onClick={async () => { await forgetCredential(); setToken(""); setStatus("Credential forgotten; local collection is kept"); }}>Forget credential</button>
    <p data-testid="sync-status" aria-live="polite">{status}</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
