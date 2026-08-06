import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { APPLICATION_ID, APPLICATION_NAME, configureApplicationIdentity, windowTitleForPath } from "./applicationIdentity";

test("application identity configures the viAI product name and Windows application ID", () => {
  const configured: { name?: string; appUserModelId?: string } = {};
  configureApplicationIdentity({
    setName: (name) => { configured.name = name; },
    setAppUserModelId: (identifier) => { configured.appUserModelId = identifier; },
  });

  assert.equal(configured.name, APPLICATION_NAME);
  assert.equal(configured.appUserModelId, APPLICATION_ID);
});

test("route titles retain the viAI base identity", () => {
  assert.equal(windowTitleForPath("/"), "Dashboard — viAI Security");
  assert.equal(windowTitleForPath("/history"), "History — viAI Security");
  assert.equal(windowTitleForPath("/realtime"), "Realtime Protection — viAI Security");
  assert.equal(windowTitleForPath("/details/assessment-1"), "File Details — viAI Security");
  assert.equal(windowTitleForPath("/unknown"), "viAI Security");
});

test("builder metadata matches the configured application identity", async () => {
  const packageJson = JSON.parse(await readFile(join(__dirname, "..", "package.json"), "utf8")) as {
    build?: { appId?: string; productName?: string; executableName?: string; nsis?: { shortcutName?: string } };
  };

  assert.equal(packageJson.build?.appId, APPLICATION_ID);
  assert.equal(packageJson.build?.productName, APPLICATION_NAME);
  assert.equal(packageJson.build?.executableName, APPLICATION_NAME);
  assert.equal(packageJson.build?.nsis?.shortcutName, APPLICATION_NAME);
});

test("bootstrap, splash, and tray use the configured product identity", async () => {
  const root = join(__dirname, "..");
  const [document, splash, main] = await Promise.all([
    readFile(join(root, "index.html"), "utf8"),
    readFile(join(root, "electron", "splash.html"), "utf8"),
    readFile(join(root, "electron", "main.ts"), "utf8"),
  ]);

  assert.match(document, /<title>viAI Security<\/title>/);
  assert.match(splash, /<title>viAI Security<\/title>/);
  assert.match(main, /title: APPLICATION_NAME/);
  assert.match(main, /skipTaskbar: true/);
  assert.match(main, /tray\.setToolTip\(APPLICATION_NAME\)/);
});