#!/usr/bin/env node
import fs from "node:fs";

const MODE = (process.env.HARDEN_MODE || "prod").trim().toLowerCase();
const ENV_FILE = (process.env.ENV_FILE || "").trim();

function parseEnvFile(input) {
  const out = {};
  const lines = input.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
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
    out[key] = value;
  }
  return out;
}

function loadEnvOverlay(filePath) {
  if (!filePath) return {};
  const input = fs.readFileSync(filePath, "utf8");
  return parseEnvFile(input);
}

const overlay = (() => {
  try {
    return loadEnvOverlay(ENV_FILE);
  } catch (err) {
    console.error(`hardening: failed to read ENV_FILE (${ENV_FILE}): ${err?.message ?? String(err)}`);
    process.exit(1);
  }
})();

function readEnv(name) {
  if (Object.prototype.hasOwnProperty.call(overlay, name)) return String(overlay[name] ?? "");
  return String(process.env[name] ?? "");
}

function parseCsvOrJsonList(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    } catch {
      // fall through to CSV
    }
  }
  return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseIceServerUrls(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const urls = [];
        for (const entry of parsed) {
          if (typeof entry === "string") {
            urls.push(entry);
            continue;
          }
          if (!entry || typeof entry !== "object") continue;
          const value = entry.urls;
          if (typeof value === "string") {
            urls.push(value);
            continue;
          }
          if (Array.isArray(value)) {
            for (const urlValue of value) {
              if (typeof urlValue === "string") urls.push(urlValue);
            }
          }
        }
        return urls.map((item) => item.trim()).filter(Boolean);
      }
    } catch {
      // fall back to CSV
    }
  }
  return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isWsUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "ws:" || parsed.protocol === "wss:";
  } catch {
    return false;
  }
}

function hostName(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isExampleHost(host) {
  const value = String(host || "").trim().toLowerCase();
  if (!value) return false;
  return value === "example.com" || value.endsWith(".example.com") || value.endsWith(".example");
}

function extractIceHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = /^(?:stun:|turn:|turns:)\[?([^\]/?:]+)\]?/i.exec(raw);
  return match ? String(match[1] || "").toLowerCase() : "";
}

function isLoopbackHost(host) {
  const value = String(host || "").trim().toLowerCase();
  return value === "localhost" || value === "::1" || value === "[::1]" || value === "127.0.0.1" || value === "0.0.0.0";
}

function isPrivateIpv4Host(host) {
  const value = String(host || "").trim().toLowerCase();
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!m) return false;
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  if (octets[0] === 10) return true;
  if (octets[0] === 127) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
  return false;
}

function isPrivateHost(host) {
  const value = String(host || "").trim().toLowerCase();
  if (!value) return false;
  return isLoopbackHost(value) || isPrivateIpv4Host(value);
}

function isDigits(value) {
  return /^\d+$/.test(String(value || "").trim());
}

function parseProfiles(raw) {
  const entries = String(raw || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.map((entry) => {
    const [id, widthRaw, heightRaw, videoBitrate, audioBitrate] = entry.split(":");
    return {
      id: String(id || "").trim(),
      widthRaw: String(widthRaw || "").trim(),
      heightRaw: String(heightRaw || "").trim(),
      videoBitrate: String(videoBitrate || "").trim(),
      audioBitrate: String(audioBitrate || "").trim()
    };
  });
}

function checkProdRules(options = {}) {
  const strictExternal = options.strictExternal === true;
  const errors = [];
  const warnings = [];

  const relayList = parseCsvOrJsonList(readEnv("NEXT_PUBLIC_NOSTR_RELAYS"));
  if (relayList.length === 0) {
    errors.push("NEXT_PUBLIC_NOSTR_RELAYS must be set.");
  } else {
    const invalidRelays = relayList.filter((relay) => !isWsUrl(relay));
    if (invalidRelays.length > 0) errors.push(`Invalid relay URL(s): ${invalidRelays.join(", ")}`);

    const wssRelays = relayList.filter((relay) => relay.startsWith("wss://"));
    if (wssRelays.length === 0) errors.push("NEXT_PUBLIC_NOSTR_RELAYS must include at least one wss:// relay in production.");
    if (wssRelays.length < 2) warnings.push("Use at least two wss:// relays for resilience.");

    if (strictExternal) {
      const insecureRelays = relayList.filter((relay) => relay.startsWith("ws://"));
      if (insecureRelays.length > 0) {
        errors.push(`Deploy mode requires wss:// relays only. Insecure entries: ${insecureRelays.join(", ")}`);
      }
      const localRelays = relayList.filter((relay) => isPrivateHost(hostName(relay)));
      if (localRelays.length > 0) {
        errors.push(`Deploy mode forbids local/private relay hosts: ${localRelays.join(", ")}`);
      }
      const exampleRelays = relayList.filter((relay) => isExampleHost(hostName(relay)));
      if (exampleRelays.length > 0) {
        errors.push(`Deploy mode forbids placeholder relay hosts: ${exampleRelays.join(", ")}`);
      }
    }
  }

  const iceRaw = readEnv("NEXT_PUBLIC_WEBRTC_ICE_SERVERS");
  const iceServers = parseIceServerUrls(iceRaw);
  if (iceServers.length === 0) {
    errors.push("NEXT_PUBLIC_WEBRTC_ICE_SERVERS must include at least one STUN/TURN server in production.");
  } else {
    const invalidIce = iceServers.filter((value) => !/^(stun:|turn:|turns:)/i.test(value));
    if (invalidIce.length > 0) warnings.push(`Unexpected ICE server format: ${invalidIce.join(", ")}`);
    const hasTurn = iceServers.some((value) => /^(turn:|turns:)/i.test(value));
    if (!hasTurn) errors.push("At least one TURN server is required in NEXT_PUBLIC_WEBRTC_ICE_SERVERS for production.");
    if (strictExternal) {
      const privateIce = iceServers.filter((value) => {
        const host = extractIceHost(value);
        return host ? isPrivateHost(host) : false;
      });
      if (privateIce.length > 0) {
        errors.push(`Deploy mode forbids local/private ICE hosts: ${privateIce.join(", ")}`);
      }

      const exampleIce = iceServers.filter((value) => {
        const host = extractIceHost(value);
        return host ? isExampleHost(host) : false;
      });
      if (exampleIce.length > 0) {
        errors.push(`Deploy mode forbids placeholder ICE hosts: ${exampleIce.join(", ")}`);
      }

      if (/replace-turn-password|changeme|example/i.test(String(iceRaw || ""))) {
        errors.push("Deploy mode forbids placeholder TURN credentials in NEXT_PUBLIC_WEBRTC_ICE_SERVERS.");
      }
    }
  }

  const hlsOrigin = readEnv("NEXT_PUBLIC_HLS_ORIGIN").trim();
  if (hlsOrigin) {
    if (!isHttpUrl(hlsOrigin)) errors.push("NEXT_PUBLIC_HLS_ORIGIN must be a valid http(s) URL.");
    if (hostName(hlsOrigin) === "localhost" || hostName(hlsOrigin) === "127.0.0.1") {
      warnings.push("NEXT_PUBLIC_HLS_ORIGIN points to localhost; this is not reachable for remote viewers.");
    }
    if (strictExternal) {
      if (!hlsOrigin.startsWith("https://")) {
        errors.push("Deploy mode requires NEXT_PUBLIC_HLS_ORIGIN to use https://.");
      }
      if (isPrivateHost(hostName(hlsOrigin))) {
        errors.push("Deploy mode requires NEXT_PUBLIC_HLS_ORIGIN to use a publicly reachable host.");
      }
      if (isExampleHost(hostName(hlsOrigin))) {
        errors.push("Deploy mode forbids placeholder NEXT_PUBLIC_HLS_ORIGIN host.");
      }
    }
  } else {
    if (strictExternal) errors.push("Deploy mode requires NEXT_PUBLIC_HLS_ORIGIN to be set.");
    else warnings.push("NEXT_PUBLIC_HLS_ORIGIN is empty; clients will use same-origin /api/hls proxy paths.");
  }

  const whipProxy = readEnv("DSTREAM_WHIP_PROXY_ORIGIN").trim();
  const whepProxy = readEnv("DSTREAM_WHEP_PROXY_ORIGIN").trim();
  const hlsProxy = readEnv("DSTREAM_HLS_PROXY_ORIGIN").trim();
  if (!isHttpUrl(whipProxy)) errors.push("DSTREAM_WHIP_PROXY_ORIGIN must be a valid http(s) URL.");
  if (whepProxy && !isHttpUrl(whepProxy)) errors.push("DSTREAM_WHEP_PROXY_ORIGIN must be a valid http(s) URL when set.");
  if (!isHttpUrl(hlsProxy)) errors.push("DSTREAM_HLS_PROXY_ORIGIN must be a valid http(s) URL.");

  const walletOrigin = readEnv("DSTREAM_XMR_WALLET_RPC_ORIGIN").trim();
  if (walletOrigin) {
    if (!isHttpUrl(walletOrigin)) errors.push("DSTREAM_XMR_WALLET_RPC_ORIGIN must be a valid http(s) URL.");
    if (strictExternal && /xmr-mock/i.test(walletOrigin)) {
      errors.push("Deploy mode forbids xmr-mock wallet RPC origin. Configure a real wallet RPC service.");
    }
    const confirmationsRaw = readEnv("DSTREAM_XMR_CONFIRMATIONS_REQUIRED").trim();
    const confirmationsEffective = confirmationsRaw || "10";
    if (!isDigits(confirmationsEffective)) errors.push("DSTREAM_XMR_CONFIRMATIONS_REQUIRED must be digits.");
    const confirmations = Number(confirmationsEffective);
    if (confirmations < 1) warnings.push("DSTREAM_XMR_CONFIRMATIONS_REQUIRED < 1 reduces payment finality.");

    const walletUser = readEnv("DSTREAM_XMR_WALLET_RPC_USER").trim();
    const walletPass = readEnv("DSTREAM_XMR_WALLET_RPC_PASS").trim();
    if (!walletUser || !walletPass) {
      errors.push("DSTREAM_XMR_WALLET_RPC_USER and DSTREAM_XMR_WALLET_RPC_PASS must be set when wallet RPC is enabled.");
    }
  } else {
    if (strictExternal) {
      errors.push("Deploy mode requires DSTREAM_XMR_WALLET_RPC_ORIGIN for Monero backend readiness.");
    } else {
      warnings.push("DSTREAM_XMR_WALLET_RPC_ORIGIN is not set; verified Monero flows will be unavailable.");
    }
  }

  const nip05Policy = readEnv("NEXT_PUBLIC_NIP05_POLICY").trim().toLowerCase();
  if (!nip05Policy) {
    warnings.push("NEXT_PUBLIC_NIP05_POLICY is unset; default policy will be used.");
  } else if (!["off", "badge", "require"].includes(nip05Policy)) {
    errors.push("NEXT_PUBLIC_NIP05_POLICY must be one of: off, badge, require.");
  }

  const sessionSecret = readEnv("DSTREAM_XMR_SESSION_SECRET").trim();
  if (!sessionSecret) {
    errors.push("DSTREAM_XMR_SESSION_SECRET is required in production.");
  } else if (sessionSecret.length < 32) {
    errors.push("DSTREAM_XMR_SESSION_SECRET should be at least 32 characters.");
  } else if (/replace|example|change-before-public-deploy|changeme/i.test(sessionSecret)) {
    errors.push("DSTREAM_XMR_SESSION_SECRET appears to be a placeholder; set a high-entropy production secret.");
  }

  if (strictExternal) {
    const devtools = readEnv("DSTREAM_DEVTOOLS").trim();
    if (!devtools) warnings.push("Deploy mode expects DSTREAM_DEVTOOLS=0.");
    if (devtools === "1") errors.push("Deploy mode requires DSTREAM_DEVTOOLS=0.");
  }

  const turnPassword = readEnv("TURN_PASSWORD").trim();
  const turnExternalIp = readEnv("TURN_EXTERNAL_IP").trim();
  if (strictExternal) {
    if (!turnExternalIp) {
      errors.push("Deploy mode requires TURN_EXTERNAL_IP when using bundled TURN service.");
    } else if (isPrivateHost(turnExternalIp)) {
      errors.push("Deploy mode requires TURN_EXTERNAL_IP to be a public IP.");
    }
    if (!turnPassword) {
      errors.push("Deploy mode requires TURN_PASSWORD when using bundled TURN service.");
    } else if (/replace-turn-password|changeme|example/i.test(turnPassword)) {
      errors.push("Deploy mode forbids placeholder TURN_PASSWORD.");
    }
  }

  const profilesRaw = readEnv("TRANSCODER_PROFILES").trim();
  if (profilesRaw) {
    const profiles = parseProfiles(profilesRaw);
    if (profiles.length === 0) errors.push("TRANSCODER_PROFILES is set but no valid entries were parsed.");
    for (const profile of profiles) {
      const width = Number(profile.widthRaw);
      const height = Number(profile.heightRaw);
      if (!profile.id) errors.push(`TRANSCODER_PROFILES entry has empty id: ${JSON.stringify(profile)}`);
      if (!Number.isFinite(width) || width <= 0 || Math.trunc(width) !== width) {
        errors.push(`TRANSCODER_PROFILES ${profile.id || "<unknown>"} has invalid width: ${profile.widthRaw}`);
      }
      if (!Number.isFinite(height) || height <= 0 || Math.trunc(height) !== height) {
        errors.push(`TRANSCODER_PROFILES ${profile.id || "<unknown>"} has invalid height: ${profile.heightRaw}`);
      }
      if (Number.isFinite(width) && width % 2 !== 0) {
        warnings.push(`TRANSCODER_PROFILES ${profile.id} width is odd (${width}); transcoder will round down.`);
      }
      if (Number.isFinite(height) && height % 2 !== 0) {
        warnings.push(`TRANSCODER_PROFILES ${profile.id} height is odd (${height}); transcoder will round down.`);
      }
      if (!profile.videoBitrate || !profile.audioBitrate) {
        errors.push(`TRANSCODER_PROFILES ${profile.id || "<unknown>"} must include video/audio bitrate.`);
      }
    }
  }

  return { errors, warnings };
}

function printResult(title, values) {
  if (values.length === 0) return;
  console.log(title);
  for (const value of values) console.log(`  - ${value}`);
}

function main() {
  const isProdMode = MODE === "prod" || MODE === "production" || MODE === "deploy" || MODE === "external";
  if (!isProdMode) {
    console.log(`hardening: mode "${MODE}" has no strict checks. Set HARDEN_MODE=prod (or deploy) for preflight.`);
    console.log("PASS");
    return;
  }

  const strictExternal = MODE === "deploy" || MODE === "external";
  const { errors, warnings } = checkProdRules({ strictExternal });

  console.log(`dStream hardening preflight (${strictExternal ? "deploy" : "prod"})`);
  if (ENV_FILE) console.log(`  env overlay: ${ENV_FILE}`);
  printResult("warnings:", warnings);
  printResult("errors:", errors);

  if (errors.length > 0) {
    console.log("FAIL");
    process.exit(1);
  }

  console.log("PASS");
}

main();
