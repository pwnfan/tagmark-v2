import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { GitHubRepository } from "../src/sync.ts";
import { parseSnapshot } from "../src/snapshot.ts";
import { githubFixture } from "../../../tests/github-fixture.ts";

test("private repository sync reads one pinned snapshot and commits without forcing the branch", async () => {
  const snapshot = { schemaVersion: 1 as const, bookmarks: [], tags: [] };
  const writes: any[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    if (request.method !== "GET") writes.push(JSON.parse(body));
    response.setHeader("content-type", "application/json");
    const path = request.url!;
    if (path === "/repos/person/data") response.end(JSON.stringify({ private: true, default_branch: "main" }));
    else if (path.endsWith("/git/ref/heads/main")) response.end(JSON.stringify({ object: { sha: "a".repeat(40) } }));
    else if (path.includes("/contents/")) {
      assert.ok(path.endsWith(`?ref=${"a".repeat(40)}`));
      response.end(JSON.stringify(snapshot));
    } else if (path === "/graphql") response.end(JSON.stringify({ data: { createCommitOnBranch: { commit: { oid: "c".repeat(40) } } } }));
    else response.end(JSON.stringify({ sha: "c".repeat(40) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const remote = new GitHubRepository("person/data", "test-secret", `http://127.0.0.1:${port}`);
    const baseline = await remote.read();
    assert.deepEqual(baseline.snapshot, parseSnapshot(snapshot));
    assert.equal(await remote.write(baseline, snapshot), "c".repeat(40));
    assert.equal(writes[0].variables.input.expectedHeadOid, "a".repeat(40));
    assert.deepEqual(writes[0].variables.input.branch, { repositoryNameWithOwner: "person/data", branchName: "main" });
    assert.deepEqual(JSON.parse(Buffer.from(writes[0].variables.input.fileChanges.additions[0].contents, "base64").toString()), parseSnapshot(snapshot));
    assert.ok(!JSON.stringify(writes).includes("test-secret"));
  } finally { server.closeAllConnections(); server.close(); }
});

test("a JSON null remote file is invalid data, never an empty instance", async () => {
  const fixture = await githubFixture();
  try {
    fixture.state.publish(null);
    const repository = new GitHubRepository("person/data", "fixture-token", fixture.origin);
    await assert.rejects(repository.read(), /Invalid snapshot/);
  } finally { fixture.close(); }
});

test("a redirect cannot forward the credential to a different host", async () => {
  let received = 0;
  const destination = createServer((_request, response) => { received++; response.end("{}"); });
  await new Promise<void>((resolve) => destination.listen(0, "127.0.0.1", resolve));
  const redirect = createServer((_request, response) => {
    response.writeHead(302, { location: `http://127.0.0.1:${(destination.address() as { port: number }).port}/stolen` }); response.end();
  });
  await new Promise<void>((resolve) => redirect.listen(0, "127.0.0.1", resolve));
  try {
    const repository = new GitHubRepository("person/data", "fixture-secret", `http://127.0.0.1:${(redirect.address() as { port: number }).port}`);
    await assert.rejects(repository.read(), /connection failed/);
    assert.equal(received, 0);
    assert.throws(() => new GitHubRepository("person/data", "fixture-secret", "https://untrusted.example"), /Untrusted/);
  } finally { redirect.closeAllConnections(); redirect.close(); destination.closeAllConnections(); destination.close(); }
});

test("privacy is checked again before commit and a stale expected head cannot overwrite a reset branch", async () => {
  const fixture = await githubFixture();
  try {
    const repository = new GitHubRepository("person/data", "fixture-token", fixture.origin);
    const baseline = await repository.read();
    const snapshot = { schemaVersion: 1 as const, bookmarks: [], tags: [] };
    fixture.state.private = false;
    await assert.rejects(repository.write(baseline, snapshot), /private repository/);
    assert.equal(fixture.state.uploads.length, 0);
    fixture.state.private = true;
    fixture.state.beforeCommit = async () => { fixture.state.head = "0".repeat(40); };
    await assert.rejects(repository.write(baseline, snapshot), /version conflict/);
    assert.equal(fixture.state.uploads.length, 0);
    assert.equal(fixture.state.head, "0".repeat(40));
  } finally { fixture.close(); }
});

test("a branch moving during download cannot mix repository versions", async () => {
  const fixture = await githubFixture();
  try {
    fixture.state.publish({ schemaVersion: 1, bookmarks: [], tags: [] });
    const pinned = fixture.state.head;
    fixture.state.beforeRead = async () => { fixture.state.publish({ schemaVersion: 99, bookmarks: [], tags: [] }); };
    const remote = await new GitHubRepository("person/data", "fixture-token", fixture.origin).read();
    assert.equal(remote.head, pinned);
    assert.equal(remote.snapshot?.schemaVersion, 1);
    assert.notEqual(fixture.state.head, pinned);
  } finally { fixture.close(); }
});
