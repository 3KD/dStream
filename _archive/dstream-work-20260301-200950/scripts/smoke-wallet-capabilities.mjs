#!/usr/bin/env node

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:5656").replace(/\/$/, "");
const REQUIRE_PROFILE = (process.env.REQUIRE_PROFILE || "stake_v2").trim();
const CAP_PROBE_MODE = (process.env.CAP_PROBE_MODE || "active").trim().toLowerCase();

const ALLOWED_PROFILES = new Set(["none", "tip_v1", "stake_v2", "escrow_v3_multisig"]);
const ALLOWED_MODES = new Set(["active", "passive"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, text, json, url };
}

function profileLine(name, profile) {
  const ready = !!profile?.ready;
  const missing = Array.isArray(profile?.missing) ? profile.missing : [];
  const suffix = missing.length ? ` (missing: ${missing.join(", ")})` : "";
  return `${name}: ${ready ? "ready" : "missing"}${suffix}`;
}

async function main() {
  assert(ALLOWED_PROFILES.has(REQUIRE_PROFILE), `REQUIRE_PROFILE must be one of: ${Array.from(ALLOWED_PROFILES).join(", ")}`);
  assert(ALLOWED_MODES.has(CAP_PROBE_MODE), `CAP_PROBE_MODE must be one of: ${Array.from(ALLOWED_MODES).join(", ")}`);

  console.log("dStream wallet capability smoke");
  console.log(`  base: ${BASE_URL}`);
  console.log(`  required profile: ${REQUIRE_PROFILE}`);
  console.log(`  probe mode: ${CAP_PROBE_MODE}`);

  const res = await request(`/api/xmr/capabilities?mode=${encodeURIComponent(CAP_PROBE_MODE)}`, { cache: "no-store" });
  assert(res.ok, `xmr capabilities failed (${res.status}): ${res.text}`);

  const profiles = res.json?.profiles ?? {};
  const tip = profiles.tip_v1 ?? null;
  const stake = profiles.stake_v2 ?? null;
  const escrow = profiles.escrow_v3_multisig ?? null;

  console.log(`wallet rpc: ok (version=${res.json?.version ?? "unknown"} mode=${res.json?.probeMode ?? "unknown"})`);
  console.log(profileLine("tip_v1", tip));
  console.log(profileLine("stake_v2", stake));
  console.log(profileLine("escrow_v3_multisig", escrow));

  if (REQUIRE_PROFILE !== "none") {
    const target = profiles[REQUIRE_PROFILE];
    assert(target, `profile not returned: ${REQUIRE_PROFILE}`);
    assert(target.ready === true, `${REQUIRE_PROFILE} not ready: missing ${(target.missing ?? []).join(", ")}`);
  }

  console.log("PASS");
}

main().catch((err) => {
  console.error("");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
