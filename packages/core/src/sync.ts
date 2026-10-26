import type { CollectionSnapshot } from "./index.ts";
import { parseSnapshot, snapshotText } from "./snapshot.ts";

export interface RemoteSnapshot { head: string; branch: string; snapshot: CollectionSnapshot | null }
const maxBytes = 10 * 1024 * 1024;
interface GitHubResponse {
  private?: unknown; default_branch?: unknown; object?: { sha?: unknown }; errors?: unknown;
  data?: { createCommitOnBranch?: { commit?: { oid?: unknown } } };
}
function responseObject(value: unknown): GitHubResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid repository response");
  return value as GitHubResponse;
}
function sha(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) throw new Error("Invalid repository version");
  return value;
}
export function validateRepository(repository: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/.test(repository) || repository.split("/")[1] === "." || repository.split("/")[1] === "..") throw new Error("Use a repository in owner/name form");
  return repository;
}

export class GitHubRepository {
  private readonly base: string;
  private readonly token: string;
  constructor(repository: string, token: string, origin = "https://api.github.com") {
    validateRepository(repository);
    // Only test callers use a loopback service; the extension never exposes this option.
    if (origin !== "https://api.github.com" && !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("Untrusted repository API origin");
    if (!token.trim() || /[\r\n]/.test(token)) throw new Error("A GitHub credential is required");
    this.base = `${origin}/repos/${repository}`;
    this.token = token;
  }
  private async request(path: string, method = "GET", body?: unknown, allowMissing = false, raw = false): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(path === "/graphql" ? new URL(this.base).origin + path : this.base + path, { method, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${this.token}`, Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new Error("Offline or repository connection failed; local changes are kept"); }
    if (response.status === 404 && allowMissing) return undefined;
    if (response.status === 409 && allowMissing && path.startsWith("/git/ref/heads/")) return undefined;
    if (!response.ok) {
      if (response.status === 409 || response.status === 422) throw new Error("Sync conflict: repository changed; local changes are kept");
      throw new Error(`Repository request failed (HTTP ${response.status}); local changes are kept`);
    }
    // Never display response bodies: they may contain secrets or private data.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty repository response");
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const part = await reader.read().catch(() => { throw new Error("Repository response interrupted; local changes are kept"); }); if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Repository snapshot exceeds 10 MiB limit"); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); }
    catch { throw new Error("Invalid repository JSON; local changes are kept"); }
  }
  private async privateRepository(): Promise<string> {
    const repo = responseObject(await this.request(""));
    if (repo.private !== true) throw new Error("Sync requires a private repository; nothing was uploaded");
    if (typeof repo.default_branch !== "string" || !repo.default_branch) throw new Error("Initialize the private repository with a README before syncing");
    return repo.default_branch;
  }
  async read(): Promise<RemoteSnapshot> {
    const branch = await this.privateRepository();
    const ref = await this.request(`/git/ref/heads/${encodeURIComponent(branch)}`, "GET", undefined, true);
    if (!ref) throw new Error("Initialize the private repository with a README before syncing");
    const head = sha(responseObject(ref).object?.sha);
    const raw = await this.request(`/contents/tagmark/collection.json?ref=${head}`, "GET", undefined, true, true);
    return { head, branch, snapshot: raw === undefined ? null : parseSnapshot(raw) };
  }
  async write(baseline: RemoteSnapshot, snapshot: CollectionSnapshot): Promise<string> {
    const content = snapshotText(parseSnapshot(snapshot)) + "\n";
    if (new TextEncoder().encode(content).length > maxBytes) throw new Error("Repository snapshot exceeds 10 MiB limit");
    if (await this.privateRepository() !== baseline.branch) throw new Error("Sync conflict: default branch changed");
    const parent = sha(baseline.head);
    const bytes = new TextEncoder().encode(content);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const next = responseObject(await this.request("/graphql", "POST", {
      query: "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }",
      variables: { input: { branch: { repositoryNameWithOwner: this.base.split("/repos/")[1], branchName: baseline.branch }, expectedHeadOid: parent,
        message: { headline: "Sync TagMark collection" }, fileChanges: { additions: [{ path: "tagmark/collection.json", contents: btoa(binary) }] } } },
    }));
    if (next.errors !== undefined && (!Array.isArray(next.errors) || next.errors.length)) throw new Error("Sync failed or repository version conflict; local changes are kept");
    return sha(next.data?.createCommitOnBranch?.commit?.oid);
  }
}
