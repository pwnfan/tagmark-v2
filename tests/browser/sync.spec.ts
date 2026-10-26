import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { githubFixture } from "../github-fixture.ts";

const exec = promisify(execFile);
const binary = resolve(`target/debug/tagmark${process.platform === "win32" ? ".exe" : ""}`);
async function configure(page: import("@playwright/test").Page, remember = false, repository = "person/data") {
  const panel = page.getByRole("region", { name: "Private repository sync" });
  await panel.getByLabel("Repository", { exact: true }).fill(repository);
  await panel.getByLabel("GitHub token", { exact: true }).fill("test-secret-only-in-auth");
  await panel.getByLabel("Remember credential on this device").setChecked(remember);
  await panel.getByRole("button", { name: "Save sync settings" }).click();
  await expect(panel.getByLabel("GitHub token", { exact: true })).toHaveValue("");
  return panel;
}
async function save(page: import("@playwright/test").Page, url: string, title: string) {
  await page.getByLabel("URL", { exact: true }).fill(url);
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
}
async function cli(collection: string, origin: string, ...args: string[]) {
  return exec(binary, ["--collection", collection, ...args], { env: { ...process.env, TAGMARK_GITHUB_TOKEN: "test-secret-only-in-auth", TAGMARK_TEST_API: origin } });
}
async function download(page: import("@playwright/test").Page, path: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download local snapshot" }).click();
  await (await pending).saveAs(path);
  return JSON.parse(await readFile(path, "utf8"));
}
async function openCollection(profile: string, origin: string) {
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, ignoreDefaultArgs: ["--disable-extensions"], args: ["--enable-unsafe-extension-debugging"] });
  const session = await context.browser()!.newBrowserCDPSession();
  const { extensions } = await session.send("Extensions.getExtensions");
  const { id } = extensions.find((extension) => extension.name === "TagMark") ?? await session.send("Extensions.loadUnpacked", { path: resolve("apps/extension/.output/chrome-mv3") });
  await routeGitHub(context, origin);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  return { context, page };
}
async function routeGitHub(context: BrowserContext, origin: string) {
  await context.route("https://api.github.com/**", async (route) => {
    const result = await route.fetch({ url: route.request().url().replace("https://api.github.com", origin), maxRedirects: 0 });
    await route.fulfill({ response: result });
  });
}
test("extension uploads a private snapshot and the CLI clones it without exporting credentials", async ({}, info) => {
  const fixture = await githubFixture();
  const { context, page } = await openCollection(info.outputPath("profile"), fixture.origin);
  try {
    await page.getByLabel("URL", { exact: true }).fill("https://example.com/sync");
    await page.getByLabel("Title", { exact: true }).fill("Synced title");
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    const panel = page.getByRole("region", { name: "Private repository sync" });
    await panel.getByLabel("Repository", { exact: true }).fill("person/data");
    await panel.getByLabel("GitHub token", { exact: true }).fill("test-secret-only-in-auth");
    await panel.getByRole("button", { name: "Save sync settings" }).click();
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByTestId("sync-status")).toContainText("Success");
    const snapshot = fixture.state.snapshot() as { bookmarks: { title: string }[] };
    expect(snapshot.bookmarks[0]!.title).toBe("Synced title");
    expect(JSON.stringify(snapshot)).not.toContain("test-secret");
    const local = info.outputPath("clone.json");
    await exec(binary, ["--collection", local, "init"]);
    const result = await exec(binary, ["--collection", local, "sync", "--repository", "person/data"], { env: { ...process.env, TAGMARK_GITHUB_TOKEN: "test-secret-only-in-auth", TAGMARK_TEST_API: fixture.origin } });
    expect(JSON.parse(result.stdout).status).toBe("success");
    expect(JSON.parse(await readFile(local, "utf8"))).toEqual(snapshot);
    expect(await readFile(local + ".sync.json", "utf8")).not.toContain("test-secret");
    await page.screenshot({ path: info.outputPath("sync-success.png"), fullPage: true });
  } finally { await context.close(); fixture.close(); }
});

test("public repository refuses upload and exposes a persistent failure state", async ({}, info) => {
  const fixture = await githubFixture(); fixture.state.private = false;
  const { context, page } = await openCollection(info.outputPath("profile"), fixture.origin);
  try {
    const panel = await configure(page);
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("private repository");
    await expect(panel.getByTestId("sync-status")).toContainText("Failure");
    const local = info.outputPath("public-refused.json");
    await cli(local, fixture.origin, "init");
    const failure = await cli(local, fixture.origin, "sync", "--repository", "person/data").then(() => null, (error: { stderr: string }) => error);
    expect(failure?.stderr).toContain("private repository");
    expect(fixture.state.uploads).toHaveLength(0);
  } finally { await context.close(); fixture.close(); }
});

test("a zero-commit private repository gets README initialization instructions without an upload", async ({}, info) => {
  const fixture = await githubFixture(); fixture.state.initialized = false;
  const { context, page } = await openCollection(info.outputPath("profile"), fixture.origin);
  try {
    const panel = await configure(page);
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("Initialize the private repository with a README");
    const local = info.outputPath("uninitialized.json"); await cli(local, fixture.origin, "init");
    const before = await readFile(local, "utf8");
    const failure = await cli(local, fixture.origin, "sync", "--repository", "person/data").then(() => null, (error: { stderr: string }) => error);
    expect(failure?.stderr).toContain("Initialize the private repository with a README");
    expect(await readFile(local, "utf8")).toBe(before);
    expect(fixture.state.uploads).toHaveLength(0);
  } finally { await context.close(); fixture.close(); }
});

test("a repository race refuses the stale upload and keeps both clients' edits", async ({}, info) => {
  const fixture = await githubFixture();
  const { context, page } = await openCollection(info.outputPath("profile"), fixture.origin);
  try {
    await save(page, "https://example.com/shared", "Shared baseline");
    const panel = await configure(page);
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByTestId("sync-status")).toContainText("Success");
    const other = info.outputPath("other.json");
    await cli(other, fixture.origin, "init");
    await cli(other, fixture.origin, "sync", "--repository", "person/data");
    const clone = JSON.parse(await readFile(other, "utf8"));
    await cli(other, fixture.origin, "edit", clone.bookmarks[0].id, "--title", "Remote title");
    await page.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    const editor = page.getByRole("form", { name: "Edit bookmark", exact: true });
    await editor.getByLabel("Private note", { exact: true }).fill("Local offline note");
    await editor.getByRole("button", { name: "Save changes" }).click();
    let raced = false;
    fixture.state.beforeCommit = async () => {
      if (raced) return; raced = true;
      await cli(other, fixture.origin, "sync", "--repository", "person/data");
    };
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("version conflict");
    expect(raced).toBe(true);
    const kept = await download(page, info.outputPath("kept.json"));
    expect(kept.bookmarks[0]).toMatchObject({ title: "Shared baseline", privateNote: "Local offline note" });
    expect(fixture.state.snapshot()).toMatchObject({ bookmarks: [{ title: "Remote title", privateNote: "" }] });
    const before = await readFile(other, "utf8");
    fixture.state.status = 401;
    const failure = await cli(other, fixture.origin, "sync", "--repository", "person/data").then(() => null, (error: { stderr: string }) => error);
    expect(failure?.stderr).toContain("HTTP 401");
    expect(failure?.stderr).not.toContain("test-secret");
    expect(failure?.stderr).not.toContain("sensitive service detail");
    expect(await readFile(other, "utf8")).toBe(before);
  } finally { await context.close(); fixture.close(); }
});

test("edits during an upload remain unsynced and can be sent on the next sync", async ({}, info) => {
  const fixture = await githubFixture();
  const { context, page } = await openCollection(info.outputPath("profile"), fixture.origin);
  let release = () => {};
  try {
    const panel = await configure(page);
    await save(page, "https://example.com/first", "First");
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    fixture.state.beforeCommit = () => waiting;
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByTestId("sync-status")).toContainText("Syncing");
    await save(page, "https://example.com/during", "During network request");
    release();
    await expect(panel.getByTestId("sync-status")).toContainText("Unsynced");
    expect(fixture.state.snapshot()).toMatchObject({ bookmarks: [{ title: "First" }] });
    expect((await download(page, info.outputPath("during.json"))).bookmarks).toHaveLength(2);
    fixture.state.beforeCommit = undefined;
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByTestId("sync-status")).toContainText("Success");
    expect(fixture.state.snapshot()).toMatchObject({ bookmarks: expect.arrayContaining([expect.objectContaining({ title: "During network request" })]) });
  } finally { release(); await context.close(); fixture.close(); }
});

test("a pull never replaces edits made while reading the remote snapshot", async ({}, info) => {
  const fixture = await githubFixture();
  const other = info.outputPath("remote.json");
  await cli(other, fixture.origin, "init");
  await cli(other, fixture.origin, "save", "https://example.com/remote", "--title", "Remote bookmark");
  await cli(other, fixture.origin, "sync", "--repository", "person/data");
  const { context, page } = await openCollection(info.outputPath("profile"), fixture.origin);
  let release = () => {};
  try {
    const panel = await configure(page);
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    fixture.state.beforeRead = () => waiting;
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByTestId("sync-status")).toContainText("Syncing");
    await save(page, "https://example.com/local", "New local bookmark");
    release();
    await expect(panel.getByRole("alert")).toContainText("Local edits changed during sync");
    const kept = await download(page, info.outputPath("local.json"));
    expect(kept.bookmarks).toMatchObject([{ title: "New local bookmark" }]);
    expect(fixture.state.snapshot()).toMatchObject({ bookmarks: [{ title: "Remote bookmark" }] });
  } finally { release(); await context.close(); fixture.close(); }
});

test("session credentials expire on restart and remembered credentials can be forgotten", async ({}, info) => {
  const fixture = await githubFixture();
  const profile = info.outputPath("profile");
  let collection = await openCollection(profile, fixture.origin);
  try {
    await configure(collection.page);
    await collection.context.close();
    collection = await openCollection(profile, fixture.origin);
    let panel = collection.page.getByRole("region", { name: "Private repository sync" });
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("token for this session");
    await configure(collection.page, true);
    await collection.context.close();
    collection = await openCollection(profile, fixture.origin);
    panel = collection.page.getByRole("region", { name: "Private repository sync" });
    await expect(panel.getByLabel("GitHub token", { exact: true })).toHaveValue("");
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByTestId("sync-status")).toContainText("Success");
    expect(JSON.stringify(await download(collection.page, info.outputPath("empty.json")))).not.toContain("test-secret");
    await panel.getByRole("button", { name: "Forget credential" }).click();
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("token for this session");
  } finally { await collection.context.close(); fixture.close(); }
});

test("offline edits resume, while a deleted remote snapshot is a conflict after the first sync", async ({}, info) => {
  const fixture = await githubFixture();
  const { context, page } = await openCollection(info.outputPath("profile"), fixture.origin);
  try {
    const panel = await configure(page);
    await context.unroute("https://api.github.com/**");
    await context.setOffline(true);
    await save(page, "https://example.com/offline", "Offline bookmark");
    await expect(panel.getByTestId("sync-status")).toContainText("Offline");
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("Offline");
    await context.setOffline(false); await routeGitHub(context, fixture.origin);
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByTestId("sync-status")).toContainText("Success");
    const clone = info.outputPath("clone.json");
    await cli(clone, fixture.origin, "init"); await cli(clone, fixture.origin, "sync", "--repository", "person/data");
    const before = await readFile(clone, "utf8");
    fixture.state.head = "a".repeat(40); // This commit contains no TagMark file.
    const uploads = fixture.state.uploads.length;
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("Sync conflict");
    await expect(page.getByRole("link", { name: "Offline bookmark" })).toBeVisible();
    const failure = await cli(clone, fixture.origin, "sync", "--repository", "person/data").then(() => null, (error: { stderr: string }) => error);
    expect(failure?.stderr).toContain("Sync conflict");
    expect(await readFile(clone, "utf8")).toBe(before);
    expect(fixture.state.uploads).toHaveLength(uploads);
  } finally { await context.close(); fixture.close(); }
});

test("invalid remote snapshots preserve both the browser and CLI collection atomically", async ({}, info) => {
  const fixture = await githubFixture();
  const { context, page } = await openCollection(info.outputPath("profile"), fixture.origin);
  try {
    await save(page, "https://example.com/local", "Keep local");
    const panel = await configure(page);
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByTestId("sync-status")).toContainText("Success");
    const clone = info.outputPath("clone.json");
    await cli(clone, fixture.origin, "init"); await cli(clone, fixture.origin, "sync", "--repository", "person/data");
    const before = await readFile(clone, "utf8");
    const cases = JSON.parse(await readFile(resolve("fixtures/sync-snapshots.json"), "utf8")) as { invalid: { name: string; snapshot: unknown }[] };
    const baselineBefore = await readFile(clone + ".sync.json", "utf8");
    for (const invalid of cases.invalid) {
      fixture.state.publish(invalid.snapshot);
      await panel.getByRole("button", { name: "Sync now", exact: true }).click();
      await expect(panel.getByTestId("sync-status")).toContainText("Failure");
      await expect(page.getByRole("link", { name: "Keep local" })).toBeVisible();
      const failure = await cli(clone, fixture.origin, "sync", "--repository", "person/data").then(() => null, (error: { stderr: string }) => error);
      expect(failure, invalid.name).not.toBeNull();
      expect(await readFile(clone, "utf8"), invalid.name).toBe(before);
      expect(await readFile(clone + ".sync.json", "utf8"), invalid.name).toBe(baselineBefore);
    }
    expect(await download(page, info.outputPath("kept.json"))).toEqual(JSON.parse(before));
  } finally { await context.close(); fixture.close(); }
});

test("legacy absent fields still pull with defaults and remain editable in both clients", async ({}, info) => {
  const fixture = await githubFixture();
  const cases = JSON.parse(await readFile(resolve("fixtures/sync-snapshots.json"), "utf8")) as { valid: { name: string; snapshot: unknown }[] };
  fixture.state.publish(cases.valid.find((item) => item.name === "legacy bookmark with absent additive fields")!.snapshot);
  const { context, page } = await openCollection(info.outputPath("profile"), fixture.origin);
  try {
    const panel = await configure(page);
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByTestId("sync-status")).toContainText("Success");
    const normalized = await download(page, info.outputPath("legacy.json"));
    expect(normalized.bookmarks[0]).toMatchObject({ fieldState: {}, tagAssignments: {}, evidence: { description: "", bodyExcerpt: "" }, ai: { includeBody: false, skip: false } });
    const clone = info.outputPath("clone.json"); await cli(clone, fixture.origin, "init");
    await cli(clone, fixture.origin, "sync", "--repository", "person/data");
    expect(JSON.parse(await readFile(clone, "utf8"))).toEqual(normalized);
    await cli(clone, fixture.origin, "edit", normalized.bookmarks[0].id, "--title", "CLI legacy edit");
    await page.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    const editor = page.getByRole("form", { name: "Edit bookmark", exact: true });
    await editor.getByLabel("Title", { exact: true }).fill("Browser legacy edit");
    await editor.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("link", { name: "Browser legacy edit", exact: true })).toBeVisible();
  } finally { await context.close(); fixture.close(); }
});

test("raw snapshots larger than 1 MiB load consistently and the 10 MiB application limit preserves local data", async ({}, info) => {
  const fixture = await githubFixture();
  const cases = JSON.parse(await readFile(resolve("fixtures/sync-snapshots.json"), "utf8"));
  const remote = cases.valid[1].snapshot;
  remote.bookmarks[0].evidence.bodyExcerpt = "large body ".repeat(110_000);
  fixture.state.publish(remote);
  const { context, page } = await openCollection(info.outputPath("profile"), fixture.origin);
  try {
    const panel = await configure(page);
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByTestId("sync-status")).toContainText("Success");
    const downloaded = await download(page, info.outputPath("large.json"));
    expect(downloaded.bookmarks[0]).toMatchObject({ deleted: true, privateNote: "Private note", evidence: remote.bookmarks[0].evidence });
    const clone = info.outputPath("clone.json");
    await cli(clone, fixture.origin, "init"); await cli(clone, fixture.origin, "sync", "--repository", "person/data");
    const before = await readFile(clone, "utf8");
    expect(JSON.parse(before)).toEqual(downloaded);
    remote.bookmarks[0].evidence.bodyExcerpt = "x".repeat(10 * 1024 * 1024);
    fixture.state.publish(remote);
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("10 MiB limit");
    const failure = await cli(clone, fixture.origin, "sync", "--repository", "person/data").then(() => null, (error: { stderr: string }) => error);
    expect(failure?.stderr).toContain("10 MiB limit");
    expect(await readFile(clone, "utf8")).toBe(before);
    expect(await download(page, info.outputPath("kept-large.json"))).toEqual(downloaded);
  } finally { await context.close(); fixture.close(); }
});

test("CLI refuses redirects without sending the credential to the destination", async ({}, info) => {
  const fixture = await githubFixture(); const destination = await githubFixture();
  try {
    fixture.state.redirect = destination.origin + "/repos/person/data";
    const clone = info.outputPath("clone.json"); await cli(clone, fixture.origin, "init");
    const before = await readFile(clone, "utf8");
    const failure = await cli(clone, fixture.origin, "sync", "--repository", "person/data").then(() => null, (error: { stderr: string }) => error);
    expect(failure?.stderr).toContain("HTTP 302");
    expect(failure?.stderr).not.toContain("test-secret");
    expect(destination.state.credentials).toHaveLength(0);
    expect(await readFile(clone, "utf8")).toBe(before);
  } finally { fixture.close(); destination.close(); }
});

test("first connection of two nonempty collections never chooses one side silently", async ({}, info) => {
  const fixture = await githubFixture();
  const remote = info.outputPath("remote.json");
  await cli(remote, fixture.origin, "init");
  await cli(remote, fixture.origin, "save", "https://example.com/remote-first", "--title", "Remote first");
  await cli(remote, fixture.origin, "sync", "--repository", "person/data");
  const originalRemote = fixture.state.snapshot();
  const { context, page } = await openCollection(info.outputPath("profile"), fixture.origin);
  try {
    await save(page, "https://example.com/local-first", "Local first");
    const panel = await configure(page);
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("Sync conflict");
    expect((await download(page, info.outputPath("first-local.json"))).bookmarks).toMatchObject([{ title: "Local first" }]);
    expect(fixture.state.snapshot()).toEqual(originalRemote);
    const cliLocal = info.outputPath("cli-local.json");
    await cli(cliLocal, fixture.origin, "init");
    await cli(cliLocal, fixture.origin, "save", "https://example.com/cli-first", "--title", "CLI first");
    const before = await readFile(cliLocal, "utf8");
    const failure = await cli(cliLocal, fixture.origin, "sync", "--repository", "person/data").then(() => null, (error: { stderr: string }) => error);
    expect(failure?.stderr).toContain("Sync conflict");
    expect(await readFile(cliLocal, "utf8")).toBe(before);
    expect(fixture.state.snapshot()).toEqual(originalRemote);
  } finally { await context.close(); fixture.close(); }
});

test("a known repository changing its default branch conflicts without forgetting either client's baseline", async ({}, info) => {
  const fixture = await githubFixture();
  const { context, page } = await openCollection(info.outputPath("profile"), fixture.origin);
  try {
    await save(page, "https://example.com/branch", "Original branch");
    const panel = await configure(page);
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByTestId("sync-status")).toContainText("Success");
    const originalHead = fixture.state.head;
    const clone = info.outputPath("clone.json"); await cli(clone, fixture.origin, "init");
    await cli(clone, fixture.origin, "sync", "--repository", "person/data");
    const localBefore = await readFile(clone, "utf8");
    const baselineBefore = await readFile(clone + ".sync.json", "utf8");
    const commitsBefore = fixture.state.commitRequests;
    fixture.state.branch = "replacement";
    fixture.state.head = "f".repeat(40); // Initialized README-only replacement branch.
    const failure = await cli(clone, fixture.origin, "sync", "--repository", "person/data").then(() => null, (error: { stderr: string }) => error);
    expect.soft(failure?.stderr).toContain("default branch changed");
    fixture.state.head = "f".repeat(40);
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect.soft(panel.getByRole("alert")).toContainText("default branch changed");
    expect(fixture.state.commitRequests).toBe(commitsBefore);
    expect(await readFile(clone, "utf8")).toBe(localBefore);
    expect(await readFile(clone + ".sync.json", "utf8")).toBe(baselineBefore);
    expect(await download(page, info.outputPath("branch-kept.json"))).toEqual(JSON.parse(localBefore));

    // Returning to the original branch must reuse the preserved baseline.
    fixture.state.branch = "main"; fixture.state.head = originalHead;
    await page.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    const editor = page.getByRole("form", { name: "Edit bookmark", exact: true });
    await editor.getByLabel("Title", { exact: true }).fill("After branch restored");
    await editor.getByRole("button", { name: "Save changes" }).click();
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByTestId("sync-status")).toContainText("Success");
    await cli(clone, fixture.origin, "sync", "--repository", "person/data");
    expect(JSON.parse(await readFile(clone, "utf8")).bookmarks[0].title).toBe("After branch restored");

    // Selecting a different private instance explicitly is still a first connection.
    fixture.state.repository = "person/other"; fixture.state.branch = "new-main"; fixture.state.head = "e".repeat(40);
    await configure(page, false, "person/other");
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByTestId("sync-status")).toContainText("Success");
    expect(fixture.state.snapshot()).toMatchObject({ bookmarks: [{ title: "After branch restored" }] });
    fixture.state.repository = "person/cli-other"; fixture.state.head = "d".repeat(40);
    await cli(clone, fixture.origin, "sync", "--repository", "person/cli-other");
    expect(fixture.state.snapshot()).toMatchObject({ bookmarks: [{ title: "After branch restored" }] });
  } finally { await context.close(); fixture.close(); }
});

test("v3 upgrade and a browser CLI roundtrip retain publication vetoes, Trash and all manual versions", async ({}, info) => {
  const fixture = await githubFixture();
  const cases = JSON.parse(await readFile(resolve("fixtures/sync-snapshots.json"), "utf8"));
  const seed = cases.valid[1].snapshot;
  const manual = { source: "manual", version: 2, protected: true };
  const tagId = seed.tags[0].id;
  seed.publication = { mode: "includeAny", includedTagIds: [tagId], excludedTagIds: [tagId],
    fieldState: { mode: manual, includedTagIds: manual, excludedTagIds: manual } };
  seed.bookmarks[0].publicationChoice = "manualPublic";
  seed.bookmarks[0].fieldState.publicationChoice = manual;
  seed.bookmarks.push({ ...structuredClone(seed.bookmarks[0]), id: "00000000-0000-4000-8000-000000000003", url: "https://example.com/vetoed", title: "Vetoed", deleted: false,
    tagAssignments: { [tagId]: { ...manual, state: "added" } } });
  seed.bookmarks.push({ ...structuredClone(seed.bookmarks[0]), id: "00000000-0000-4000-8000-000000000004", url: "https://example.com/published", title: "Published", deleted: false, tagAssignments: {} });
  const { context, page } = await openCollection(info.outputPath("profile"), fixture.origin);
  try {
    // Seed the previously released v3 format at the real persistent-storage boundary.
    await page.evaluate(async (snapshot) => {
      await new Promise<void>((resolve, reject) => {
        const remove = indexedDB.deleteDatabase("tagmark"); remove.onsuccess = () => resolve(); remove.onerror = () => reject(remove.error);
      });
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("tagmark", 3);
        request.onupgradeneeded = () => {
          const bookmarks = request.result.createObjectStore("bookmarks", { keyPath: "id" }); bookmarks.createIndex("url", "url", { unique: true });
          const tags = request.result.createObjectStore("tags", { keyPath: "id" }); tags.createIndex("canonicalName", "canonicalName", { unique: true });
          request.result.createObjectStore("settings");
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction(["bookmarks", "tags", "settings"], "readwrite");
          for (const bookmark of snapshot.bookmarks) transaction.objectStore("bookmarks").put(bookmark);
          for (const tag of snapshot.tags) transaction.objectStore("tags").put(tag);
          transaction.objectStore("settings").put(snapshot.publication, "publication");
          transaction.oncomplete = () => { request.result.close(); resolve(); };
          transaction.onabort = () => { request.result.close(); reject(transaction.error); };
        };
      });
    }, seed);
    await page.reload();
    const before = await download(page, info.outputPath("v3-upgraded.json"));
    expect(before).toEqual(seed);
    const panel = await configure(page);
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByTestId("sync-status")).toContainText("Success");
    expect(fixture.state.snapshot()).toEqual(seed);
    const clone = info.outputPath("clone.json");
    await cli(clone, fixture.origin, "init"); await cli(clone, fixture.origin, "sync", "--repository", "person/data");
    expect(JSON.parse(await readFile(clone, "utf8"))).toEqual(seed);
    await cli(clone, fixture.origin, "edit", seed.bookmarks[0].id, "--private-note", "CLI edit while in Trash");
    await cli(clone, fixture.origin, "sync", "--repository", "person/data");
    await panel.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(panel.getByTestId("sync-status")).toContainText("Success");
    const after = await download(page, info.outputPath("roundtrip.json"));
    expect(after).toEqual(JSON.parse(await readFile(clone, "utf8")));
    expect(after.publication).toEqual(seed.publication);
    expect(after.bookmarks[0]).toMatchObject({ deleted: true, privateNote: "CLI edit while in Trash", fieldState: { privateNote: { version: 4 }, deleted: { version: 2 }, publicationChoice: { version: 2 } } });
    const publicOutput = await cli(clone, fixture.origin, "public-export");
    expect(JSON.parse(publicOutput.stdout).bookmarks).toEqual([{ url: "https://example.com/published", title: "Published", tagIds: [] }]);
    expect(publicOutput.stdout).not.toMatch(/Private note|Captured body|CLI edit|test-secret/);
  } finally { await context.close(); fixture.close(); }
});
