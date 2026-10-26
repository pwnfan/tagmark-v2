import { browser } from "wxt/browser";
import { GitHubRepository, snapshotText, validateRepository } from "@tagmark/core";
import { collectionSnapshot, finishSync, syncBaseline } from "./collection";

export interface SyncSettings { repository: string; remember: boolean }
const key = "githubCredential";

async function trustedStorage() {
  await browser.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await browser.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}
export async function readSyncSettings(): Promise<SyncSettings | undefined> {
  await trustedStorage();
  return (await browser.storage.local.get("syncSettings")).syncSettings as SyncSettings | undefined;
}
export async function saveSyncSettings(settings: SyncSettings, token: string) {
  validateRepository(settings.repository);
  if (!token.trim() || /[\r\n]/.test(token)) throw new Error("Enter a GitHub token");
  await trustedStorage();
  await browser.storage.local.remove(key); await browser.storage.session.remove(key);
  await (settings.remember ? browser.storage.local : browser.storage.session).set({ [key]: token });
  await browser.storage.local.set({ syncSettings: settings });
}
export async function forgetCredential() {
  await browser.storage.local.remove(key); await browser.storage.session.remove(key);
}
export async function isSynced(): Promise<boolean> {
  const settings = await readSyncSettings();
  const baseline = await syncBaseline();
  return !!settings && !!baseline && settings.repository.toLowerCase() === baseline.repository.toLowerCase()
    && snapshotText(await collectionSnapshot()) === snapshotText(baseline.snapshot);
}
export async function syncCollection(): Promise<boolean> {
  return navigator.locks.request("tagmark-sync", async () => {
    const settings = await readSyncSettings();
    if (!settings) throw new Error("Save repository settings first");
    const token = (await (settings.remember ? browser.storage.local : browser.storage.session).get(key))[key];
    if (typeof token !== "string" || !token) throw new Error("Enter a GitHub token for this session");
    const local = await collectionSnapshot();
    const stored = await syncBaseline();
    const repository = new GitHubRepository(settings.repository, token);
    const remote = await repository.read();
    const baseline = stored?.repository.toLowerCase() === settings.repository.toLowerCase() ? stored : undefined;
    if (baseline && baseline.branch !== remote.branch) throw new Error("Sync conflict: default branch changed; local changes and sync baseline are kept");
    const localText = snapshotText(local);
    let next = local;
    if (remote.snapshot && snapshotText(remote.snapshot) === localText) { /* already consistent */ }
    else if (!remote.snapshot && !baseline) remote.head = await repository.write(remote, local);
    else if (remote.snapshot && baseline?.head === remote.head) remote.head = await repository.write(remote, local);
    else if (remote.snapshot && ((baseline && snapshotText(baseline.snapshot) === localText)
      || (!baseline && localText === snapshotText({ schemaVersion: 1, bookmarks: [], tags: [] })))) next = remote.snapshot;
    else throw new Error("Sync conflict: local and remote changes are kept; automatic merge is not available yet");
    return finishSync(local, { repository: settings.repository, branch: remote.branch, head: remote.head, snapshot: next });
  });
}
