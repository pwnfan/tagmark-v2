import { chromium, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exportPublicCollection, previewPublication, type CollectionSnapshot } from "../../packages/core/src/index.ts";

const extensionPath = resolve("apps/extension/.output/chrome-mv3");

test("publication previews rules and manual choices before saving and matches the CLI public whitelist", async ({}, testInfo) => {
  const profile = testInfo.outputPath("profile");
  let collection = await openCollection(profile);
  try {
    let page = collection.page;
    await page.getByLabel("URL", { exact: true }).fill("https://example.com/publication");
    await page.getByLabel("Title", { exact: true }).fill("Public resource");
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await page.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    const editor = page.getByRole("form", { name: "Edit bookmark", exact: true });
    await editor.getByLabel("Private note", { exact: true }).fill("PRIVATE_NOTE_SENTINEL");
    await editor.getByLabel("Body excerpt", { exact: true }).fill("PRIVATE_BODY_SENTINEL");
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    for (const name of ["rust", "private", "unused"]) {
      const create = page.getByRole("form", { name: "Create tag", exact: true });
      await create.getByLabel("English canonical name", { exact: true }).fill(name);
      await create.getByLabel("Short English definition", { exact: true }).fill(name === "unused" ? "PRIVATE_UNUSED_SENTINEL" : `${name} resources.`);
      await create.getByLabel("Inclusion", { exact: true }).fill("PRIVATE_RULE_SENTINEL");
      await create.getByRole("button", { name: "Create tag", exact: true }).click();
      await expect(page.getByRole("form", { name: `Edit tag ${name}`, exact: true })).toBeVisible();
    }
    const bookmark = page.locator("article");
    await bookmark.getByLabel("Choose tag", { exact: true }).selectOption({ label: "rust" });
    await bookmark.getByRole("button", { name: "Add tag", exact: true }).click();
    await expect(bookmark).toContainText("rust — added");
    const manager = page.getByRole("region", { name: "Publication selection", exact: true });
    await expect(manager.getByLabel("Base mode", { exact: true })).toHaveValue("manualOnly");
    await manager.getByRole("button", { name: "Preview changes", exact: true }).click();
    await expect(manager).toContainText("Selected: 0 · Added: 0 · Removed: 0");
    await manager.getByLabel("Base mode", { exact: true }).selectOption("includeAny");
    await manager.getByLabel("Include rust", { exact: true }).check();
    await manager.getByLabel("Exclude private", { exact: true }).check();
    await manager.getByRole("button", { name: "Preview changes", exact: true }).click();
    await expect(manager).toContainText("Selected: 1 · Added: 1 · Removed: 0");
    await expect(manager).toContainText("Included tag: rust");
    await expect(manager).toContainText("AI");
    const readSnapshot = async (name: string): Promise<CollectionSnapshot> => {
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download local snapshot", exact: true }).click()]);
      const path = testInfo.outputPath(name); await download.saveAs(path);
      return JSON.parse(readFileSync(path, "utf8"));
    };
    expect((await readSnapshot("before-save.json")).publication?.mode).toBe("manualOnly");
    await page.screenshot({ path: testInfo.outputPath("publication-preview.png"), fullPage: true });
    await manager.screenshot({ path: testInfo.outputPath("publication-manager.png") });
    await manager.getByRole("button", { name: "Save publication choices", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Publication choices saved");
    let snapshot = await readSnapshot("saved.json");
    const cli = (file: string, command: string) => JSON.parse(execFileSync("cargo", ["run", "--quiet", "--", "--collection", testInfo.outputPath(file), command], { encoding: "utf8" }));
    expect(cli("saved.json", "publication-preview")).toEqual(previewPublication(snapshot));
    expect(cli("saved.json", "public-export")).toEqual(exportPublicCollection(snapshot));
    expect(JSON.stringify(cli("saved.json", "public-export"))).not.toMatch(/PRIVATE_|"(?:fieldState|rules|publication|tagAssignments)":/);
    await bookmark.getByLabel("Choose tag", { exact: true }).selectOption({ label: "private" });
    await bookmark.getByRole("button", { name: "Add tag", exact: true }).click();
    await expect(bookmark).toContainText("private — added");
    await manager.getByLabel("Publication choice for Public resource", { exact: true }).selectOption("manualPublic");
    await manager.getByRole("button", { name: "Preview changes", exact: true }).click();
    await expect(manager).toContainText("Blocked by excluded tag: private");
    await expect(manager).toContainText("Selected: 0");
    await manager.getByRole("button", { name: "Save publication choices", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Publication choices saved");
    snapshot = await readSnapshot("veto.json");
    expect(snapshot.bookmarks[0]?.fieldState.publicationChoice?.version).toBe(1);
    expect(cli("veto.json", "public-export")).toEqual({ schemaVersion: 1, bookmarks: [], tags: [] });
    await bookmark.getByRole("button", { name: "Reject tag", exact: true }).click();
    await expect(bookmark).toContainText("private — rejected");
    snapshot = await readSnapshot("rejected.json");
    expect(exportPublicCollection(snapshot).bookmarks).toHaveLength(1);
    await collection.context.close();
    collection = await openCollection(profile); page = collection.page;
    await expect(page.getByLabel("Publication choice for Public resource", { exact: true })).toHaveValue("manualPublic");
    await expect(page.getByLabel("Base mode", { exact: true })).toHaveValue("includeAny");
  } finally { await collection.context.close(); }
});

test("publication retains dirty drafts across managers and rejects saving a stale preview", async ({}, testInfo) => {
  const { context, page } = await openCollection(testInfo.outputPath("profile"));
  try {
    await page.getByLabel("URL", { exact: true }).fill("https://example.com/first");
    await page.getByLabel("Title", { exact: true }).fill("First resource");
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    const create = page.getByRole("form", { name: "Create tag", exact: true });
    await create.getByLabel("English canonical name", { exact: true }).fill("private");
    await create.getByLabel("Short English definition", { exact: true }).fill("Private resources.");
    await create.getByRole("button", { name: "Create tag", exact: true }).click();
    const manager = page.getByRole("region", { name: "Publication selection", exact: true });
    await manager.getByLabel("Base mode", { exact: true }).selectOption("allMinusExcluded");
    await manager.getByRole("button", { name: "Preview changes", exact: true }).click();
    await expect(manager).toContainText("Selected: 1 · Added: 1 · Removed: 0");
    await manager.getByRole("button", { name: "Save publication choices", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Publication choices saved");
    await expect(manager).toContainText("Saved desired selection: 1");
    await manager.getByLabel("Exclude private", { exact: true }).check();
    await manager.getByLabel("Publication choice for First resource", { exact: true }).selectOption("manualPrivate");
    const other = await context.newPage(); await other.goto(page.url());
    const second = other.getByRole("region", { name: "Publication selection", exact: true });
    await second.getByLabel("Base mode", { exact: true }).selectOption("includeAny");
    await second.getByRole("button", { name: "Preview changes", exact: true }).click();
    await expect(second).toContainText("Selected: 0 · Added: 0 · Removed: 1");
    await second.getByRole("button", { name: "Save publication choices", exact: true }).click();
    await expect(other.getByRole("status")).toContainText("Publication choices saved");
    // A local refresh must update untouched fields while retaining the first manager's edits.
    await page.getByLabel("URL", { exact: true }).fill("https://example.com/second");
    await page.getByLabel("Title", { exact: true }).fill("Second resource");
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await expect(manager.getByLabel("Base mode", { exact: true })).toHaveValue("includeAny");
    await expect(manager.getByLabel("Exclude private", { exact: true })).toBeChecked();
    await expect(manager.getByLabel("Publication choice for First resource", { exact: true })).toHaveValue("manualPrivate");
    await manager.getByRole("button", { name: "Preview changes", exact: true }).click();
    await expect(manager).toContainText("Manually private");
    await other.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    const editor = other.getByRole("form", { name: "Edit bookmark", exact: true });
    await editor.getByLabel("Private note", { exact: true }).fill("Other manager note");
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await manager.getByRole("button", { name: "Save publication choices", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Collection changed since the preview");
    await expect(manager.getByLabel("Exclude private", { exact: true })).toBeChecked();
    await manager.getByRole("button", { name: "Preview changes", exact: true }).click();
    await manager.getByRole("button", { name: "Save publication choices", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Publication choices saved");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download local snapshot", exact: true }).click()]);
    const path = testInfo.outputPath("concurrent-publication.json"); await download.saveAs(path);
    const saved: CollectionSnapshot = JSON.parse(readFileSync(path, "utf8"));
    expect(saved.publication?.fieldState.mode?.version).toBe(2);
    expect(saved.publication?.fieldState.excludedTagIds?.version).toBe(1);
    const first = saved.bookmarks.find((bookmark) => bookmark.title === "First resource");
    expect(first?.publicationChoice).toBe("manualPrivate");
    expect(first?.privateNote).toBe("Other manager note");
    expect(first?.fieldState.publicationChoice?.version).toBe(1);
  } finally { await context.close(); }
});

test("publication upgrade preserves a v2 device cache including Trash, evidence and protected rejections", async ({}, testInfo) => {
  const { context, page } = await openCollection(testInfo.outputPath("profile"));
  try {
    const manual = { source: "manual", version: 2, protected: true };
    const tagId = "20000000-0000-4000-8000-000000000001";
    const legacy = {
      bookmarks: [{ id: "10000000-0000-4000-8000-000000000001", url: "https://example.com/legacy", title: "Legacy resource", deleted: true,
        privateNote: "Legacy private note", evidence: { description: "Legacy description", bodyExcerpt: "Legacy paragraph" }, ai: { includeBody: true, skip: true },
        fieldState: { deleted: manual, title: manual }, tagAssignments: { [tagId]: { ...manual, state: "rejected" } } }],
      tags: [{ id: tagId, canonicalName: "legacy", definition: "Legacy resources.", rules: { inclusion: "Private rule", exclusion: "", examples: "" }, fieldState: { definition: manual } }],
    };
    // Seed the previous released cache format through the real browser database boundary.
    await page.evaluate(async (seed) => {
      await new Promise<void>((resolve, reject) => {
        const remove = indexedDB.deleteDatabase("tagmark"); remove.onsuccess = () => resolve(); remove.onerror = () => reject(remove.error);
      });
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("tagmark", 2);
        request.onupgradeneeded = () => {
          const bookmarks = request.result.createObjectStore("bookmarks", { keyPath: "id" }); bookmarks.createIndex("url", "url", { unique: true });
          const tags = request.result.createObjectStore("tags", { keyPath: "id" }); tags.createIndex("canonicalName", "canonicalName", { unique: true });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction(["bookmarks", "tags"], "readwrite");
          seed.bookmarks.forEach((bookmark) => transaction.objectStore("bookmarks").add(bookmark));
          seed.tags.forEach((tag) => transaction.objectStore("tags").add(tag));
          transaction.oncomplete = () => { request.result.close(); resolve(); };
          transaction.onabort = () => { request.result.close(); reject(transaction.error); };
        };
      });
    }, legacy);
    await page.reload();
    await expect(page.getByLabel("Base mode", { exact: true })).toHaveValue("manualOnly");
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await expect(page.getByRole("link", { name: "Legacy resource", exact: true })).toBeVisible();
    await expect(page.locator("article")).toContainText("legacy — rejected · protected");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download local snapshot", exact: true }).click()]);
    const path = testInfo.outputPath("upgraded-v2.json"); await download.saveAs(path);
    const snapshot: CollectionSnapshot = JSON.parse(readFileSync(path, "utf8"));
    expect(snapshot.bookmarks).toEqual(legacy.bookmarks.map((bookmark) => ({ ...bookmark, publicationChoice: "followRules" })));
    expect(snapshot.tags).toEqual(legacy.tags);
    expect(snapshot.publication).toEqual({ mode: "manualOnly", includedTagIds: [], excludedTagIds: [], fieldState: {} });
    expect(JSON.parse(execFileSync("cargo", ["run", "--quiet", "--", "--collection", path, "list", "--trash"], { encoding: "utf8" }))).toEqual(snapshot.bookmarks);
  } finally { await context.close(); }
});

test("offline edits preserve identity, evidence choices and private notes across restart and snapshot export", async ({}, testInfo) => {
  const profile = testInfo.outputPath("profile");
  let collection = await openCollection(profile);
  try {
    let page = collection.page;
    await collection.context.setOffline(true);
    await page.getByLabel("URL", { exact: true }).fill("https://example.com/original");
    await page.getByLabel("Title", { exact: true }).fill("Original");
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    const originalId = await page.locator("article").getAttribute("id");
    await page.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    const editor = page.getByRole("form", { name: "Edit bookmark" });
    await editor.getByLabel("Title", { exact: true }).fill("Chosen title");
    await editor.getByLabel("URL", { exact: true }).fill("HTTPS://EXAMPLE.COM:443/edited");
    await editor.getByLabel("Private note", { exact: true }).fill("Private decision");
    await editor.getByLabel("Page description", { exact: true }).fill("Allowed description");
    await editor.getByLabel("Body excerpt", { exact: true }).fill("Allowed paragraph");
    await editor.getByLabel("Allow body excerpt for AI", { exact: true }).check();
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("link", { name: "Chosen title" })).toHaveAttribute("href", "https://example.com/edited");
    await expect(page.locator("article")).toHaveAttribute("id", originalId!);
    await collection.context.close();
    collection = await openCollection(profile);
    page = collection.page;
    await page.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    const reopened = page.getByRole("form", { name: "Edit bookmark" });
    await expect(reopened.getByRole("textbox", { name: "Private note", exact: true })).toHaveValue("Private decision");
    await expect(reopened.getByLabel("Allow body excerpt for AI", { exact: true })).toBeChecked();
    await reopened.getByLabel("Skip AI for this bookmark", { exact: true }).check();
    await reopened.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(reopened).toHaveCount(0);
    await page.getByLabel("URL", { exact: true }).fill("https://example.com/edited");
    await page.getByLabel("Title", { exact: true }).fill("Do not overwrite");
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Already saved");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download local snapshot" }).click(),
    ]);
    const snapshotPath = testInfo.outputPath("edited.json");
    await download.saveAs(snapshotPath);
    const listed = JSON.parse(execFileSync("cargo", ["run", "--quiet", "--", "--collection", snapshotPath, "list"], { encoding: "utf8" }));
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ title: "Chosen title", privateNote: "Private decision", evidence: { description: "Allowed description", bodyExcerpt: "Allowed paragraph" }, ai: { includeBody: true, skip: true }, fieldState: { title: { source: "manual", version: 1, protected: true } } });
    expect(JSON.parse(execFileSync("cargo", ["run", "--quiet", "--", "--collection", snapshotPath, "ai-evidence", listed[0].id], { encoding: "utf8" }))).toBeNull();
  } finally {
    await collection.context.close();
  }
});

test("Trash keeps a bookmark through restart and duplicate save until explicit restore", async ({}, testInfo) => {
  const profile = testInfo.outputPath("profile");
  let collection = await openCollection(profile);
  try {
    let page = collection.page;
    await page.getByLabel("URL", { exact: true }).fill("https://example.com/keep");
    await page.getByLabel("Title", { exact: true }).fill("Keep my title");
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await expect(page.locator("article:focus")).toBeVisible();
    const originalId = await page.locator("article:focus").getAttribute("id");
    await page.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    const editor = page.getByRole("form", { name: "Edit bookmark", exact: true });
    await editor.getByLabel("Private note", { exact: true }).fill("Private decision");
    await editor.getByLabel("Page description", { exact: true }).fill("Retained description");
    await editor.getByLabel("Body excerpt", { exact: true }).fill("Retained paragraph");
    await editor.getByLabel("Allow body excerpt for AI", { exact: true }).check();
    await editor.getByLabel("Skip AI for this bookmark", { exact: true }).check();
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(editor).toHaveCount(0);
    for (const [name, action] of [["reading", "Add tag"], ["unrelated", "Reject tag"]]) {
      const create = page.getByRole("form", { name: "Create tag", exact: true });
      await create.getByLabel("English canonical name", { exact: true }).fill(name!);
      await create.getByLabel("Short English definition", { exact: true }).fill(`Definition for ${name}`);
      await create.getByRole("button", { name: "Create tag", exact: true }).click();
      await page.getByLabel("Choose tag", { exact: true }).selectOption({ label: name! });
      await page.getByRole("button", { name: action!, exact: true }).click();
      await expect(page.locator("article")).toContainText(`${name} — ${action === "Add tag" ? "added" : "rejected"} · protected`);
    }
    const [beforeDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download local snapshot", exact: true }).click(),
    ]);
    const beforePath = testInfo.outputPath("before-trash.json");
    await beforeDownload.saveAs(beforePath);
    const before = JSON.parse(readFileSync(beforePath, "utf8"));
    await page.getByRole("button", { name: "Move to Trash", exact: true }).click({ timeout: 5000 });
    await expect(page.locator("article")).toHaveCount(0);
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await expect(page.getByRole("link", { name: "Keep my title", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    const trashEditor = page.getByRole("form", { name: "Edit bookmark", exact: true });
    await trashEditor.getByLabel("Private note", { exact: true }).fill("Edited while in Trash");
    await trashEditor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(trashEditor).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Restore bookmark", exact: true })).toBeVisible();
    await collection.context.close();
    collection = await openCollection(profile);
    page = collection.page;
    await expect(page.locator("article")).toHaveCount(0);
    await page.getByLabel("URL", { exact: true }).fill("https://example.com/keep");
    await page.getByLabel("Title", { exact: true }).fill("Do not replace");
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("In Trash");
    await expect(page.locator("article:focus")).toHaveAttribute("id", originalId!);
    await expect(page.getByRole("link", { name: "Keep my title", exact: true })).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download local snapshot", exact: true }).click(),
    ]);
    const snapshotPath = testInfo.outputPath("trash.json");
    await download.saveAs(snapshotPath);
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const trash = JSON.parse(execFileSync("cargo", ["run", "--quiet", "--", "--collection", snapshotPath, "list", "--trash"], { encoding: "utf8" }));
    expect(trash).toEqual(snapshot.bookmarks);
    expect(trash).toHaveLength(1);
    expect(trash[0].deleted).toBe(true);
    expect(trash[0].fieldState.deleted).toEqual({ source: "manual", version: 1, protected: true });
    expect(snapshot.tags).toEqual(before.tags);
    expect(trash[0]).toEqual({ ...before.bookmarks[0], deleted: true, privateNote: "Edited while in Trash",
      fieldState: { ...before.bookmarks[0].fieldState,
        privateNote: { source: "manual", version: 2, protected: true },
        deleted: { source: "manual", version: 1, protected: true } } });
    await page.screenshot({ path: testInfo.outputPath("trash.png"), fullPage: true });
    await page.getByRole("button", { name: "Restore bookmark", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(0);
    await page.getByRole("button", { name: "Saved bookmarks", exact: true }).click();
    await expect(page.locator("article")).toHaveAttribute("id", originalId!);
    await expect(page.getByRole("link", { name: "Keep my title", exact: true })).toBeVisible();
    const [restoredDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download local snapshot", exact: true }).click(),
    ]);
    const restoredPath = testInfo.outputPath("restored.json");
    await restoredDownload.saveAs(restoredPath);
    const restored = JSON.parse(readFileSync(restoredPath, "utf8"));
    expect(restored.bookmarks).toEqual([{ ...trash[0], deleted: false,
      fieldState: { ...trash[0].fieldState, deleted: { source: "manual", version: 2, protected: true } } }]);
    expect(restored.tags).toEqual(before.tags);
  } finally {
    await collection.context.close();
  }
});

async function openCollection(profile: string) {
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging"],
  });
  try {
    const browser = context.browser();
    if (!browser) throw new Error("A Chromium browser is required");
    const session = await browser.newBrowserCDPSession();
    const { extensions } = await session.send("Extensions.getExtensions");
    const installed = extensions.find((extension) => extension.name === "TagMark");
    const { id } = installed ?? await session.send("Extensions.loadUnpacked", { path: extensionPath });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/options.html`);
    return { context, page, session, id };
  } catch (error) {
    await context.close();
    throw error;
  }
}

test("a bookmark saved offline remains after restarting the browser", async ({}, testInfo) => {
  const profile = testInfo.outputPath("profile");
  let collection = await openCollection(profile);
  try {
    await collection.context.setOffline(true);
    await collection.page.getByLabel("URL", { exact: true }).fill("https://example.com/read#intro");
    await collection.page.getByLabel("Title", { exact: true }).fill("Offline reading");
    await collection.page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await expect(collection.page.getByRole("link", { name: "Offline reading", exact: true }))
      .toHaveAttribute("href", "https://example.com/read#intro");
    await collection.context.close();

    collection = await openCollection(profile);
    await expect(collection.page.getByRole("link", { name: "Offline reading", exact: true }))
      .toHaveAttribute("href", "https://example.com/read#intro");
    await collection.page.screenshot({ path: testInfo.outputPath("manager.png"), fullPage: true });
  } finally {
    await collection.context.close();
  }
});

test("the extension action saves the current page with its title and full URL", async ({}, testInfo) => {
  const collection = await openCollection(testInfo.outputPath("profile"));
  try {
    const article = await collection.context.newPage();
    await article.route("https://example.test/**", (route) => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><title>A useful article</title><meta name="description" content="A useful description"><h1>Read me</h1>',
    }));
    await article.goto("https://example.test/read?b=2&a=1#intro");
    const { targetInfos } = await collection.session.send("Target.getTargets", { filter: [{ type: "tab" }] });
    const targetInfo = targetInfos.find((target) => target.url === article.url());
    if (!targetInfo) throw new Error("The article tab was not found");
    const [popup] = await Promise.all([
      collection.context.waitForEvent("page"),
      collection.session.send("Extensions.triggerAction", { id: collection.id, targetId: targetInfo.targetId }),
    ]);
    await expect(popup.getByLabel("Allow body excerpt for AI", { exact: true })).not.toBeChecked();
    await popup.getByLabel("Skip AI for this bookmark", { exact: true }).check();
    await popup.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await expect(popup.getByRole("status")).toContainText("saved");
    await popup.screenshot({ path: testInfo.outputPath("popup.png") });
    await collection.page.reload();
    await expect(collection.page.getByRole("link", { name: "A useful article", exact: true }))
      .toHaveAttribute("href", "https://example.test/read?b=2&a=1#intro");
    await collection.page.getByRole("button", { name: "Move to Trash", exact: true }).click();
    await expect(collection.page.locator("article")).toHaveCount(0);
    await popup.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await expect(popup.getByRole("status")).toContainText("In Trash");
    const trashLink = await popup.getByRole("link", { name: "View bookmark in Trash", exact: true }).getAttribute("href");
    await collection.page.goto(trashLink!);
    await expect(collection.page.getByRole("button", { name: "Trash", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(collection.page.locator("article:focus").getByRole("link", { name: "A useful article", exact: true })).toBeVisible();

    await collection.page.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    await expect(collection.page.getByRole("textbox", { name: "Body excerpt", exact: true })).toHaveValue("");
    await expect(collection.page.getByRole("textbox", { name: "Page description", exact: true })).toHaveValue("A useful description");
    await expect(collection.page.getByLabel("Skip AI for this bookmark", { exact: true })).toBeChecked();
    await popup.close();
    await article.goto("https://example.test/active");
    const { targetInfos: updatedTargets } = await collection.session.send("Target.getTargets", { filter: [{ type: "tab" }] });
    const activeTarget = updatedTargets.find((target) => target.url === article.url());
    const [activePopup] = await Promise.all([
      collection.context.waitForEvent("page"),
      collection.session.send("Extensions.triggerAction", { id: collection.id, targetId: activeTarget!.targetId }),
    ]);
    await activePopup.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await expect(activePopup.getByRole("status")).toContainText("saved");
    const activeLink = await activePopup.getByRole("link", { name: "View saved bookmark", exact: true }).getAttribute("href");
    await collection.page.goto(activeLink!);
    await expect(collection.page.getByRole("button", { name: "Saved bookmarks", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(collection.page.locator("article:focus").getByRole("link", { name: "A useful article", exact: true })).toHaveAttribute("href", "https://example.test/active");
  } finally {
    await collection.context.close();
  }
});

test("explicit popup capture saves allowed page evidence without form secrets, cookies or other tabs", async ({}, testInfo) => {
  const collection = await openCollection(testInfo.outputPath("profile"));
  try {
    const background = await collection.context.newPage();
    await background.route("https://unselected.test/", (route) => route.fulfill({ contentType: "text/html", body: "<title>Other tab</title><p>other-tab-secret</p>" }));
    await background.goto("https://unselected.test/");
    const article = await collection.context.newPage();
    await article.route("https://example.test/**", (route) => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><title>Allowed title</title><meta name="description" content="Allowed description"><main><p>Allowed paragraph</p><input type="password" value="password-secret"><textarea>draft-secret</textarea><div contenteditable="true">edit-secret</div><script>const token="script-secret"</script><p hidden>hidden-secret</p></main>',
    }));
    await article.goto("https://example.test/evidence");
    await article.evaluate(() => { document.cookie = "session=cookie-secret"; });
    const { targetInfos } = await collection.session.send("Target.getTargets", { filter: [{ type: "tab" }] });
    const target = targetInfos.find((target) => target.url === article.url());
    const [popup] = await Promise.all([
      collection.context.waitForEvent("page"),
      collection.session.send("Extensions.triggerAction", { id: collection.id, targetId: target!.targetId }),
    ]);
    await expect(popup.getByRole("checkbox", { name: "Allow body excerpt for AI", exact: true })).toBeVisible();
    await popup.getByLabel("Allow body excerpt for AI", { exact: true }).check();
    await popup.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await expect(popup.getByRole("status")).toContainText("saved");
    await collection.page.reload();
    await collection.page.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    await expect(collection.page.getByRole("textbox", { name: "Page description", exact: true })).toHaveValue("Allowed description");
    await expect(collection.page.getByRole("textbox", { name: "Body excerpt", exact: true })).toHaveValue("Allowed paragraph");
    await collection.page.getByText("Preview allowed AI evidence", { exact: true }).click();
    await expect(collection.page.locator("pre")).toHaveText(JSON.stringify({ title: "Allowed title", description: "Allowed description", bodyExcerpt: "Allowed paragraph" }, null, 2));
    await collection.page.screenshot({ path: testInfo.outputPath("evidence-editor.png"), fullPage: true });
    const [download] = await Promise.all([
      collection.page.waitForEvent("download"),
      collection.page.getByRole("button", { name: "Download local snapshot" }).click(),
    ]);
    const snapshotPath = testInfo.outputPath("captured.json");
    await download.saveAs(snapshotPath);
    const snapshot = readFileSync(snapshotPath, "utf8");
    expect(snapshot).not.toContain("secret");
    expect(JSON.parse(snapshot).bookmarks).toHaveLength(1);
  } finally { await collection.context.close(); }
});

test("a URL collision reports an error without changing either bookmark", async ({}, testInfo) => {
  const { context, page } = await openCollection(testInfo.outputPath("profile"));
  try {
    for (const title of ["First", "Second"]) {
      await page.getByLabel("URL", { exact: true }).fill(`https://example.com/${title.toLowerCase()}`);
      await page.getByLabel("Title", { exact: true }).fill(title);
      await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
      await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
    }
    const first = page.locator("article").filter({ has: page.getByRole("link", { name: "First", exact: true }) });
    await first.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    const editor = first.getByRole("form", { name: "Edit bookmark" });
    await editor.getByLabel("URL", { exact: true }).fill("HTTPS://EXAMPLE.COM:443/second");
    await editor.getByLabel("Title", { exact: true }).fill("Must not change");
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("already saved");
    await page.reload();
    await expect(page.locator("article")).toHaveCount(2);
    await expect(page.getByRole("link", { name: "First", exact: true })).toHaveAttribute("href", "https://example.com/first");
    await expect(page.getByRole("link", { name: "Second", exact: true })).toHaveAttribute("href", "https://example.com/second");
  } finally { await context.close(); }
});

test("saving an edit changes only the fields the user touched", async ({}, testInfo) => {
  const { context, page } = await openCollection(testInfo.outputPath("profile"));
  try {
    await page.getByLabel("URL", { exact: true }).fill("https://example.com/independent-edits");
    await page.getByLabel("Title", { exact: true }).fill("Original");
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await expect(page.getByRole("link", { name: "Original", exact: true })).toBeVisible();
    const other = await context.newPage();
    await other.goto(page.url());
    for (const manager of [page, other]) await manager.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    await page.getByRole("form", { name: "Edit bookmark" }).getByLabel("Title", { exact: true }).fill("Updated title");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("link", { name: "Updated title", exact: true })).toBeVisible();
    await other.getByRole("textbox", { name: "Private note", exact: true }).fill("Independent note");
    await other.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(other.getByRole("form", { name: "Edit bookmark" })).toHaveCount(0);
    await expect(other.getByRole("link", { name: "Updated title", exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test("refreshing bookmark props retains drafts and does not turn untouched fields into edits", async ({}, testInfo) => {
  const { context, page } = await openCollection(testInfo.outputPath("profile"));
  try {
    const saveForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Save bookmark", exact: true }) });
    await saveForm.getByLabel("URL", { exact: true }).fill("https://example.com/shared-draft");
    await saveForm.getByLabel("Title", { exact: true }).fill("Original");
    await saveForm.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await page.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    const editor = page.getByRole("form", { name: "Edit bookmark", exact: true });
    await editor.getByLabel("Page description", { exact: true }).fill("My unsaved evidence");
    const other = await context.newPage();
    await other.goto(page.url());
    await other.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    const secondEditor = other.getByRole("form", { name: "Edit bookmark", exact: true });
    await secondEditor.getByLabel("Title", { exact: true }).fill("Other manager title");
    await secondEditor.getByLabel("Page description", { exact: true }).fill("Other manager evidence");
    await secondEditor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(secondEditor).toHaveCount(0);
    await saveForm.getByLabel("URL", { exact: true }).fill("https://example.com/refresh");
    await saveForm.getByLabel("Title", { exact: true }).fill("Another bookmark");
    await saveForm.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await expect(page.getByRole("link", { name: "Another bookmark", exact: true })).toBeVisible();
    await expect(editor.getByLabel("Page description", { exact: true })).toHaveValue("My unsaved evidence");
    await editor.getByLabel("Private note", { exact: true }).fill("My private decision");
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(editor).toHaveCount(0);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download local snapshot", exact: true }).click(),
    ]);
    const path = testInfo.outputPath("refreshed-draft.json");
    await download.saveAs(path);
    const snapshot = JSON.parse(readFileSync(path, "utf8"));
    const bookmark = snapshot.bookmarks.find((entry: { url: string }) => entry.url === "https://example.com/shared-draft");
    expect(bookmark.title).toBe("Other manager title");
    expect(bookmark.fieldState.title).toEqual({ source: "manual", version: 1, protected: true });
    expect(bookmark.privateNote).toBe("My private decision");
    expect(bookmark.evidence.description).toBe("My unsaved evidence");
    expect(bookmark.fieldState["evidence.description"]).toEqual({ source: "manual", version: 2, protected: true });
  } finally { await context.close(); }
});

test("a local snapshot downloaded from the extension can be read by the CLI", async ({}, testInfo) => {
  const collection = await openCollection(testInfo.outputPath("profile"));
  try {
    await collection.page.getByLabel("URL", { exact: true }).fill("https://example.com/portable");
    await collection.page.getByLabel("Title", { exact: true }).fill("Take this with me");
    await collection.page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await expect(collection.page.getByRole("link", { name: "Take this with me", exact: true })).toBeVisible();
    const [downloaded] = await Promise.all([
      collection.page.waitForEvent("download"),
      collection.page.getByRole("button", { name: "Download local snapshot", exact: true }).click(),
    ]);
    const snapshotPath = testInfo.outputPath("collection.json");
    await downloaded.saveAs(snapshotPath);
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const listed = JSON.parse(execFileSync("cargo", ["run", "--quiet", "--", "--collection", snapshotPath, "list"], { encoding: "utf8" }));
    expect(snapshot.schemaVersion).toBe(1);
    expect(listed).toEqual(snapshot.bookmarks);
    expect(listed).toHaveLength(1);
    expect(listed[0].title).toBe("Take this with me");
  } finally {
    await collection.context.close();
  }
});

test("saving a duplicate opens the original bookmark and keeps its title and ID", async ({}, testInfo) => {
  const { context, page } = await openCollection(testInfo.outputPath("profile"));
  try {
    await page.getByLabel("URL", { exact: true }).fill("https://example.com/");
    await page.getByLabel("Title", { exact: true }).fill("My chosen title");
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await expect(page.locator("article:focus")).toBeVisible();
    const originalId = await page.locator("article:focus").getAttribute("id");
    await page.getByLabel("URL", { exact: true }).fill("HTTPS://EXAMPLE.COM:443");
    await page.getByLabel("Title", { exact: true }).fill("Do not replace my title");
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Already saved");
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "My chosen title", exact: true })).toBeVisible();
    await expect(page.locator("article:focus")).toHaveAttribute("id", originalId!);
  } finally {
    await context.close();
  }
});

test("the actual extension follows every shared URL identity example", async ({}, testInfo) => {
  const examples: {
    normalizations: { input: string; expected: string }[];
    pairs: { left: string; right: string; same: boolean }[];
    invalid: string[];
  } = JSON.parse(readFileSync("fixtures/url-identity.json", "utf8"));
  const { context, page } = await openCollection(testInfo.outputPath("profile"));
  let sequence = 0;
  async function save(input: string) {
    await page.getByLabel("URL", { exact: true }).fill(input);
    await page.getByLabel("Title", { exact: true }).fill(`Identity sample ${++sequence}`);
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    const bookmark = page.locator("article:focus");
    await expect(bookmark).toBeVisible();
    return { id: await bookmark.getAttribute("id"), url: await bookmark.getByRole("link").getAttribute("href") };
  }
  try {
    for (const { input, expected } of examples.normalizations) {
      expect((await save(input)).url, input).toBe(expected);
    }
    for (const { left, right, same } of examples.pairs) {
      const first = await save(left);
      const second = await save(right);
      expect(first.id === second.id, `${left} and ${right}`).toBe(same);
    }
    const count = await page.locator("article").count();
    for (const input of examples.invalid) {
      await page.getByLabel("URL", { exact: true }).fill(input);
      await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
      await expect(page.getByRole("alert")).toHaveText(/\S/);
      await expect(page.locator("article")).toHaveCount(count);
    }
  } finally {
    await context.close();
  }
});

test("bookmark edits, evidence and protected tags persist together and match the CLI snapshot", async ({}, testInfo) => {
  const profile = testInfo.outputPath("profile");
  let collection = await openCollection(profile);
  try {
    let page = collection.page;
    await expect(page.getByRole("button", { name: "Create tag", exact: true })).toBeVisible();
    await page.getByLabel("URL", { exact: true }).fill("https://example.com/tags");
    await page.getByLabel("Title", { exact: true }).fill("My resource");
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    const create = page.getByRole("form", { name: "Create tag" });
    await create.getByLabel("English canonical name", { exact: true }).fill(" HTTP ");
    await create.getByLabel("Short English definition", { exact: true }).fill("The HTTP protocol.");
    await create.getByLabel("Inclusion", { exact: true }).fill("Resources about the protocol.");
    await create.getByRole("button", { name: "Create tag", exact: true }).click();
    const tag = page.getByRole("form", { name: "Edit tag http", exact: true });
    await expect(tag).toBeVisible();
    await create.getByLabel("English canonical name", { exact: true }).fill("HTTP");
    await create.getByLabel("Short English definition", { exact: true }).fill("Different meaning.");
    await create.getByRole("button", { name: "Create tag", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("already exists");
    await tag.getByLabel("Short English definition", { exact: true }).fill("Resources teaching HTTP.");
    await tag.getByLabel("Exclusion", { exact: true }).fill("Incidental use of HTTP.");
    await tag.getByRole("button", { name: "Save tag changes", exact: true }).click();
    await expect(tag.getByText("Protected fields: Name, Definition, Inclusion, Exclusion", { exact: true })).toBeVisible();
    const bookmark = page.locator("article");
    await bookmark.getByLabel("Choose tag", { exact: true }).selectOption({ label: "http" });
    await bookmark.getByRole("button", { name: "Add tag", exact: true }).click();
    await expect(bookmark.getByText("http — added · protected", { exact: true })).toBeVisible();
    await bookmark.getByRole("button", { name: "Reject tag", exact: true }).click();
    await expect(bookmark.getByText("http — rejected · protected", { exact: true })).toBeVisible();
    await bookmark.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    const bookmarkEditor = bookmark.getByRole("form", { name: "Edit bookmark", exact: true });
    await bookmarkEditor.getByLabel("Title", { exact: true }).fill("My revised resource");
    await bookmarkEditor.getByLabel("URL", { exact: true }).fill("https://example.com/edited-tags");
    await bookmarkEditor.getByLabel("Private note", { exact: true }).fill("My private judgment");
    await bookmarkEditor.getByLabel("Page description", { exact: true }).fill("Protocol reference");
    await bookmarkEditor.getByLabel("Body excerpt", { exact: true }).fill("Allowed protocol evidence");
    await bookmarkEditor.getByLabel("Allow body excerpt for AI", { exact: true }).check();
    await bookmarkEditor.getByLabel("Skip AI for this bookmark", { exact: true }).check();
    await bookmarkEditor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(bookmarkEditor).toHaveCount(0);
    await expect(bookmark.getByText("http — rejected · protected", { exact: true })).toBeVisible();
    await page.getByLabel("URL", { exact: true }).fill("HTTPS://EXAMPLE.COM:443/edited-tags");
    await page.getByLabel("Title", { exact: true }).fill("Ignored");
    await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await expect(page.getByRole("status").first()).toContainText("Already saved");
    await collection.context.close();
    collection = await openCollection(profile);
    page = collection.page;
    await expect(page.getByText("http — rejected · protected", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "My revised resource", exact: true })).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download local snapshot", exact: true }).click(),
    ]);
    const snapshotPath = testInfo.outputPath("collection.json");
    await download.saveAs(snapshotPath);
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const cli = (path: string, args: string[]) => JSON.parse(execFileSync("cargo", ["run", "--quiet", "--", "--collection", path, ...args], { encoding: "utf8" }));
    expect(cli(snapshotPath, ["tags"])).toEqual(snapshot.tags);
    expect(cli(snapshotPath, ["list"])).toEqual(snapshot.bookmarks);
    const cliPath = testInfo.outputPath("cli.json");
    cli(cliPath, ["init"]);
    const saved = cli(cliPath, ["save", "https://example.com/tags", "--title", "My resource"]);
    const created = cli(cliPath, ["tag-create", " HTTP ", "--definition", "The HTTP protocol.", "--inclusion", "Resources about the protocol."]);
    const edited = cli(cliPath, ["tag-edit", created.id, "--definition", "Resources teaching HTTP.", "--exclusion", "Incidental use of HTTP."]);
    cli(cliPath, ["tag-add", saved.bookmark.id, created.id]);
    cli(cliPath, ["tag-reject", saved.bookmark.id, created.id]);
    const editedBookmark = cli(cliPath, ["edit", saved.bookmark.id, "--title", "My revised resource", "--url", "https://example.com/edited-tags", "--private-note", "My private judgment", "--description", "Protocol reference", "--body-excerpt", "Allowed protocol evidence", "--include-body", "true", "--skip-ai", "true"]);
    expect(cli(cliPath, ["save", "HTTPS://EXAMPLE.COM:443/edited-tags", "--title", "Ignored"])).toEqual({ created: false, bookmark: editedBookmark });
    expect(snapshot.tags[0]).toEqual({ ...edited, id: snapshot.tags[0].id });
    expect(snapshot.bookmarks[0]).toEqual({ ...editedBookmark, id: snapshot.bookmarks[0].id,
      tagAssignments: { [snapshot.tags[0].id]: editedBookmark.tagAssignments[created.id] } });
    expect(snapshot.bookmarks[0]).toMatchObject({ privateNote: "My private judgment", evidence: { description: "Protocol reference", bodyExcerpt: "Allowed protocol evidence" }, ai: { includeBody: true, skip: true }, fieldState: { title: { source: "manual", version: 1, protected: true } } });
    expect(cli(snapshotPath, ["ai-evidence", snapshot.bookmarks[0].id])).toBeNull();
    await page.getByRole("button", { name: "Edit bookmark", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("edits-evidence-tags.png"), fullPage: true });
  } finally {
    await collection.context.close();
  }
});

test("two managers retain tag drafts and save only the fields the user edited", async ({}, testInfo) => {
  const { context, page } = await openCollection(testInfo.outputPath("profile"));
  try {
    const create = page.getByRole("form", { name: "Create tag", exact: true });
    await create.getByLabel("English canonical name", { exact: true }).fill("http");
    await create.getByLabel("Short English definition", { exact: true }).fill("Original definition.");
    await create.getByRole("button", { name: "Create tag", exact: true }).click();
    const firstEditor = page.getByRole("form", { name: "Edit tag http", exact: true });
    await expect(firstEditor).toBeVisible();
    const other = await context.newPage();
    await other.goto(page.url());
    const secondEditor = other.getByRole("form", { name: "Edit tag http", exact: true });
    await secondEditor.getByLabel("Short English definition", { exact: true }).fill("New manual definition.");
    await secondEditor.getByRole("button", { name: "Save tag changes", exact: true }).click();
    await expect(other.getByRole("status")).toContainText("Tag changes saved");

    // Creating a different tag refreshes the first editor's props without reloading it.
    await create.getByLabel("English canonical name", { exact: true }).fill("other");
    await create.getByLabel("Short English definition", { exact: true }).fill("Another concept.");
    await create.getByRole("button", { name: "Create tag", exact: true }).click();
    await expect(page.getByRole("form", { name: "Edit tag other", exact: true })).toBeVisible();
    await firstEditor.getByLabel("Exclusion", { exact: true }).fill("Exclude incidental use.");
    await firstEditor.getByRole("button", { name: "Save tag changes", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Tag changes saved");
    const downloadSnapshot = async (name: string) => {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Download local snapshot", exact: true }).click(),
      ]);
      const path = testInfo.outputPath(name);
      await download.saveAs(path);
      return JSON.parse(readFileSync(path, "utf8"));
    };
    const snapshot = await downloadSnapshot("two-managers.json");
    const tag = snapshot.tags.find((candidate: { canonicalName: string }) => candidate.canonicalName === "http");
    expect(tag.definition).toBe("New manual definition.");
    expect(tag.fieldState.definition).toEqual({ source: "manual", version: 2, protected: true });
    expect(tag.rules.exclusion).toBe("Exclude incidental use.");

    // A refresh must also retain unsaved input when another manager edits the same field.
    await firstEditor.getByLabel("Inclusion", { exact: true }).fill("My unsaved inclusion.");
    await secondEditor.getByLabel("Inclusion", { exact: true }).fill("Other manager inclusion.");
    await secondEditor.getByRole("button", { name: "Save tag changes", exact: true }).click();
    await expect(other.getByRole("status")).toContainText("Tag changes saved");
    await create.getByLabel("English canonical name", { exact: true }).fill("third");
    await create.getByLabel("Short English definition", { exact: true }).fill("Third concept.");
    await create.getByRole("button", { name: "Create tag", exact: true }).click();
    await expect(page.getByRole("form", { name: "Edit tag third", exact: true })).toBeVisible();
    await expect(firstEditor.getByLabel("Inclusion", { exact: true })).toHaveValue("My unsaved inclusion.");
    await expect(firstEditor.getByLabel("Short English definition", { exact: true })).toHaveValue("New manual definition.");
    await firstEditor.getByRole("button", { name: "Save tag changes", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Tag changes saved");
    const after = (await downloadSnapshot("two-managers-draft.json")).tags.find((candidate: { canonicalName: string }) => candidate.canonicalName === "http");
    expect(after.rules.inclusion).toBe("My unsaved inclusion.");
    expect(after.fieldState.definition).toEqual(tag.fieldState.definition);
    expect(after.rules.exclusion).toBe(tag.rules.exclusion);
  } finally {
    await context.close();
  }
});
