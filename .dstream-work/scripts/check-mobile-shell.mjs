#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

function resolvePath(relPath) {
  return path.resolve(root, relPath);
}

function readText(relPath) {
  const full = resolvePath(relPath);
  if (!existsSync(full)) {
    errors.push(`missing file: ${relPath}`);
    return "";
  }
  return readFileSync(full, "utf8");
}

function assertMatch(source, pattern, message) {
  if (!pattern.test(source)) errors.push(message);
}

function assertFile(relPath) {
  if (!existsSync(resolvePath(relPath))) errors.push(`missing file: ${relPath}`);
}

function run() {
  const requiredFiles = [
    "apps/mobile/package.json",
    "apps/mobile/capacitor.config.ts",
    "apps/mobile/www/index.html",
    "apps/mobile/www/mobile.js",
    "apps/mobile/www/mobile.css",
    "apps/mobile/golden/ui.snapshot.json",
    "docs/MOBILE_APP.md",
    "docs/MOBILE_RELEASE_CHECKLIST.md"
  ];
  for (const file of requiredFiles) assertFile(file);

  const mobilePackageRaw = readText("apps/mobile/package.json");
  if (mobilePackageRaw) {
    let mobilePackage;
    try {
      mobilePackage = JSON.parse(mobilePackageRaw);
    } catch {
      errors.push("apps/mobile/package.json is not valid JSON");
    }
    if (mobilePackage) {
      const deps = mobilePackage.dependencies ?? {};
      if (!deps["@capacitor/core"]) errors.push("apps/mobile/package.json missing dependency: @capacitor/core");
      if (!deps["@capacitor/preferences"]) errors.push("apps/mobile/package.json missing dependency: @capacitor/preferences");
      if (!mobilePackage.scripts?.sync) errors.push("apps/mobile/package.json missing script: sync");
      if (!mobilePackage.scripts?.["open:ios"]) errors.push("apps/mobile/package.json missing script: open:ios");
      if (!mobilePackage.scripts?.["open:android"]) errors.push("apps/mobile/package.json missing script: open:android");
    }
  }

  const capConfig = readText("apps/mobile/capacitor.config.ts");
  if (capConfig) {
    assertMatch(capConfig, /appId:\s*"stream\.dstream\.mobile"/, "capacitor config missing expected appId");
    assertMatch(capConfig, /webDir:\s*"www"/, "capacitor config missing expected webDir");
  }

  const indexHtml = readText("apps/mobile/www/index.html");
  if (indexHtml) {
    const requiredIds = [
      "saved-panel",
      "setup-form",
      "edge-url",
      "relay-list",
      "launch-existing",
      "edit-config",
      "reset-config",
      "save-only",
      "cancel-edit",
      "storage-mode"
    ];
    for (const id of requiredIds) {
      if (!indexHtml.includes(`id="${id}"`)) errors.push(`apps/mobile/www/index.html missing id="${id}"`);
    }
  }

  const mobileJs = readText("apps/mobile/www/mobile.js");
  if (mobileJs) {
    assertMatch(mobileJs, /APP_CONFIG_KEY\s*=\s*"dstream_mobile_config_v1"/, "mobile.js missing stable config key");
    assertMatch(mobileJs, /Preferences\.get/, "mobile.js missing native storage read (Preferences.get)");
    assertMatch(mobileJs, /Preferences\.set/, "mobile.js missing native storage write (Preferences.set)");
    assertMatch(mobileJs, /Preferences\.remove/, "mobile.js missing native storage delete (Preferences.remove)");
    assertMatch(mobileJs, /new URL\("\/mobile\/bootstrap"/, "mobile.js missing bootstrap handoff");
  }

  const docs = readText("docs/MOBILE_APP.md");
  if (docs) {
    assertMatch(docs, /Capacitor Preferences/i, "docs/MOBILE_APP.md missing native storage reference");
    assertMatch(docs, /Node & Relays/i, "docs/MOBILE_APP.md missing post-setup editor reference");
    assertMatch(docs, /golden/i, "docs/MOBILE_APP.md missing golden-check reference");
  }

  const releaseChecklist = readText("docs/MOBILE_RELEASE_CHECKLIST.md");
  if (releaseChecklist) {
    assertMatch(releaseChecklist, /iOS/i, "docs/MOBILE_RELEASE_CHECKLIST.md missing iOS section");
    assertMatch(releaseChecklist, /Android/i, "docs/MOBILE_RELEASE_CHECKLIST.md missing Android section");
    assertMatch(releaseChecklist, /permissions/i, "docs/MOBILE_RELEASE_CHECKLIST.md missing permission checklist");
  }

  if (errors.length > 0) {
    console.error("mobile shell check failed:");
    for (const error of errors) console.error(` - ${error}`);
    process.exit(1);
  }

  console.log("mobile shell check: PASS");
}

run();
