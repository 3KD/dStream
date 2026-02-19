#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const target = (process.env.MOBILE_RELEASE_TARGET ?? "all").trim().toLowerCase();
const strict = process.env.MOBILE_RELEASE_STRICT === "1";
const releaseEnvFile = (process.env.MOBILE_RELEASE_ENV_FILE ?? "").trim();
const errors = [];
const warnings = [];

function full(relPath) {
  return path.resolve(root, relPath);
}

function requireFile(relPath) {
  if (!existsSync(full(relPath))) errors.push(`missing file: ${relPath}`);
}

function read(relPath) {
  try {
    return readFileSync(full(relPath), "utf8");
  } catch {
    errors.push(`failed to read file: ${relPath}`);
    return "";
  }
}

function loadReleaseEnv() {
  if (!releaseEnvFile) return;
  const absolute = path.isAbsolute(releaseEnvFile) ? releaseEnvFile : full(releaseEnvFile);
  if (!existsSync(absolute)) {
    errors.push(`MOBILE_RELEASE_ENV_FILE not found: ${absolute}`);
    return;
  }
  const raw = readFileSync(absolute, "utf8");
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || String(process.env[key]).trim() === "") {
      process.env[key] = value;
    }
  }
}

function requireEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) errors.push(`missing env: ${name}`);
  return value;
}

function requireEnvFilePath(name) {
  const value = requireEnv(name);
  if (!value) return;
  const absolute = path.isAbsolute(value) ? value : full(value);
  if (!existsSync(absolute)) errors.push(`env path not found: ${name}=${absolute}`);
}

function validateFiles() {
  const required = [
    "apps/mobile/Gemfile",
    "apps/mobile/fastlane/Appfile",
    "apps/mobile/fastlane/Fastfile",
    "apps/mobile/release.env.example",
    "docs/MOBILE_STORE_DEPLOY.md",
    "scripts/mobile-release.sh",
    "scripts/mobile-release-setup.sh",
    "scripts/mobile-permissions-smoke.sh"
  ];
  for (const relPath of required) requireFile(relPath);

  const fastfile = read("apps/mobile/fastlane/Fastfile");
  if (fastfile) {
    if (!/platform :ios/.test(fastfile)) errors.push("Fastfile missing ios platform lanes.");
    if (!/platform :android/.test(fastfile)) errors.push("Fastfile missing android platform lanes.");
    if (!/lane :testflight/.test(fastfile)) errors.push("Fastfile missing ios:testflight lane.");
    if (!/lane :appstore/.test(fastfile)) errors.push("Fastfile missing ios:appstore lane.");
    if (!/lane :internal/.test(fastfile)) errors.push("Fastfile missing android:internal lane.");
    if (!/lane :production/.test(fastfile)) errors.push("Fastfile missing android:production lane.");
  }
}

function validateEnvForIos() {
  requireEnv("IOS_APP_IDENTIFIER");
  requireEnv("APP_STORE_CONNECT_API_KEY_ID");
  requireEnv("APP_STORE_CONNECT_ISSUER_ID");

  const keyPath = String(process.env.APP_STORE_CONNECT_API_KEY_PATH ?? "").trim();
  const keyInline = String(process.env.APP_STORE_CONNECT_API_KEY ?? "").trim();
  if (!keyPath && !keyInline) {
    errors.push("missing env: APP_STORE_CONNECT_API_KEY_PATH or APP_STORE_CONNECT_API_KEY");
  } else if (keyPath) {
    requireEnvFilePath("APP_STORE_CONNECT_API_KEY_PATH");
  }
}

function validateEnvForAndroid() {
  requireEnv("ANDROID_APPLICATION_ID");
  requireEnvFilePath("ANDROID_PLAY_JSON_KEY_PATH");
  requireEnvFilePath("ANDROID_KEYSTORE_PATH");
  requireEnv("ANDROID_KEYSTORE_PASSWORD");
  requireEnv("ANDROID_KEY_ALIAS");
  requireEnv("ANDROID_KEY_PASSWORD");
}

function main() {
  loadReleaseEnv();
  validateFiles();

  if (strict) {
    if (target === "ios" || target === "all") validateEnvForIos();
    if (target === "android" || target === "all") validateEnvForAndroid();
  } else {
    warnings.push("MOBILE_RELEASE_STRICT is not set; env secret checks skipped.");
  }

  if (warnings.length > 0) {
    console.log("warnings:");
    for (const warning of warnings) console.log(` - ${warning}`);
  }

  if (errors.length > 0) {
    console.error("mobile store release check failed:");
    for (const error of errors) console.error(` - ${error}`);
    process.exit(1);
  }

  console.log("mobile store release check: PASS");
}

main();
