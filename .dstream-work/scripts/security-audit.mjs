import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function audit(args) {
  const result = spawnSync("npm", ["audit", "--json", ...args], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error || !result.stdout) throw new Error("Dependency audit could not run.");
  const report = JSON.parse(result.stdout);
  if (report.error || !report.metadata || !report.vulnerabilities) throw new Error("Dependency audit returned no valid advisory report.");
  return report;
}

function inspectServerImports(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, item.name);
    if (item.isDirectory()) inspectServerImports(file);
    else if (/\.(ts|tsx)$/.test(item.name) && !item.name.includes(".test.")) {
      if (/@solana\/(?:web3\.js|spl-token)/.test(readFileSync(file, "utf8"))) {
        throw new Error(`Solana SDK server import invalidates the native-buffer applicability exception: ${file}`);
      }
    }
  }
}

try {
  // The native overflow is not present in bigint-buffer's browser implementation.
  // This exception expires; no critical advisory is exempted.
  const bufferException = "https://github.com/advisories/GHSA-3gc7-fjrx-p6mg";
  const exceptionValid = Date.now() < Date.parse("2026-11-14T00:00:00Z");
  inspectServerImports("apps/web/app/api");
  inspectServerImports("apps/web/src/lib/payments/server");
  const wallet = readFileSync("apps/web/src/lib/payments/nativeWallet.ts", "utf8");
  if (!wallet.startsWith('"use client";') || !wallet.includes('if (typeof window === "undefined")')) {
    throw new Error("Solana browser-only boundary changed; review dependency applicability.");
  }
  const web = audit(["--workspace", "web", "--omit=dev"]);
  const full = audit([]);
  const blocked = new Set();
  for (const item of Object.values(web.vulnerabilities)) {
    for (const via of item.via) {
      if (typeof via === "string" || !["high", "critical"].includes(via.severity)) continue;
      if (via.severity !== "critical" && via.url === bufferException && exceptionValid) continue;
      blocked.add(`${via.severity}: ${via.name} ${via.url}`);
    }
  }
  if (full.metadata.vulnerabilities.critical > 0) blocked.add("Critical dependency advisories remain in the workspace/native build toolchain.");
  if (blocked.size) throw new Error([...blocked].join("\n"));
  console.log(`Dependency gate passed: web ${JSON.stringify(web.metadata.vulnerabilities)}; workspace critical=0.`);
  console.log("One native-buffer advisory is dispositioned browser-only until 2026-11-14; see docs/SECURITY.md. Moderate and development-only high findings remain visible.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
