import { createServer } from "node:http";

/** Controlled GitHub boundary. Each commit retains its own immutable file bytes. */
export async function githubFixture() {
  const versions = new Map<string, unknown>();
  let sequence = 1;
  const state = {
    head: sequence.toString(16).padStart(40, "0"), repository: "person/data", branch: "main", private: true, initialized: true, status: 200, redirect: "",
    beforeRead: undefined as (() => Promise<void>) | undefined,
    beforeCommit: undefined as (() => Promise<void>) | undefined,
    credentials: [] as string[], uploads: [] as unknown[], commitRequests: 0,
    publish(snapshot: unknown) {
      state.head = (++sequence).toString(16).padStart(40, "0");
      versions.set(state.head, structuredClone(snapshot));
    },
    snapshot() { return structuredClone(versions.get(state.head)); },
  };
  const server = createServer(async (request, response) => {
    state.credentials.push(request.headers.authorization ?? "");
    response.setHeader("content-type", "application/json");
    if (state.redirect) { response.writeHead(302, { location: state.redirect }); response.end(); return; }
    if (state.status !== 200) { response.writeHead(state.status); response.end('{"message":"sensitive service detail"}'); return; }
    const path = request.url!;
    const base = `/repos/${state.repository}`;
    if (path === base) response.end(JSON.stringify({ private: state.private, default_branch: state.branch }));
    else if (path === `${base}/git/ref/heads/${encodeURIComponent(state.branch)}`) {
      if (!state.initialized) { response.writeHead(409); response.end('{"message":"Git Repository is empty."}'); }
      else response.end(JSON.stringify({ object: { sha: state.head } }));
    }
    else if (path.startsWith(`${base}/contents/tagmark/collection.json?ref=`)) {
      const head = path.split("?ref=")[1]!;
      await state.beforeRead?.();
      if (!versions.has(head)) { response.writeHead(404); response.end("{}"); }
      else {
        const body = JSON.stringify(versions.get(head));
        // GitHub omits content in the ordinary JSON media type above 1 MiB.
        response.end(Buffer.byteLength(body) > 1024 * 1024 && request.headers.accept !== "application/vnd.github.raw+json"
          ? JSON.stringify({ content: "", encoding: "none" }) : body);
      }
    } else if (path === "/graphql" && request.method === "POST") {
      state.commitRequests++;
      let body = "";
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body).variables.input;
      await state.beforeCommit?.();
      if (input.expectedHeadOid !== state.head || input.branch.repositoryNameWithOwner !== state.repository || input.branch.branchName !== state.branch) response.end(JSON.stringify({ errors: [{ message: "Expected branch or head mismatch" }] }));
      else {
        const snapshot = JSON.parse(Buffer.from(input.fileChanges.additions[0].contents, "base64").toString());
        state.uploads.push(snapshot); state.publish(snapshot);
        response.end(JSON.stringify({ data: { createCommitOnBranch: { commit: { oid: state.head } } } }));
      }
    } else { response.writeHead(404); response.end("{}"); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { state, origin, close() { server.closeAllConnections(); server.close(); } };
}
