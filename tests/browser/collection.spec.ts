import { chromium, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const extensionPath = resolve("apps/extension/.output/chrome-mv3");

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
      body: "<!doctype html><title>A useful article</title><h1>Read me</h1>",
    }));
    await article.goto("https://example.test/read?b=2&a=1#intro");
    const { targetInfos } = await collection.session.send("Target.getTargets", { filter: [{ type: "tab" }] });
    const targetInfo = targetInfos.find((target) => target.url === article.url());
    if (!targetInfo) throw new Error("The article tab was not found");
    const [popup] = await Promise.all([
      collection.context.waitForEvent("page"),
      collection.session.send("Extensions.triggerAction", { id: collection.id, targetId: targetInfo.targetId }),
    ]);
    await popup.getByRole("button", { name: "Save bookmark", exact: true }).click();
    await expect(popup.getByRole("status")).toContainText("saved");
    await popup.screenshot({ path: testInfo.outputPath("popup.png") });
    await collection.page.reload();
    await expect(collection.page.getByRole("link", { name: "A useful article", exact: true }))
      .toHaveAttribute("href", "https://example.test/read?b=2&a=1#intro");
  } finally {
    await collection.context.close();
  }
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
