import os from "node:os";
import { promises as fs } from "node:fs";
import path from "node:path";

function isUsableIpv4(address) {
  if (!address || typeof address !== "string") return false;
  if (address === "127.0.0.1") return false;
  if (address.startsWith("169.254.")) return false; // link-local
  return true;
}

function detectHostIpv4() {
  const nets = os.networkInterfaces();
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4") continue;
      if (addr.internal) continue;
      if (!isUsableIpv4(addr.address)) continue;
      return addr.address;
    }
  }
  return null;
}

const repoRoot = process.cwd();
const templatePath = path.join(repoRoot, "infra/stream/mediamtx.yml");
const outputPath = "/tmp/dstream-mediamtx.yml";

const hostIpv4 = detectHostIpv4();
if (!hostIpv4) {
  console.error("gen-mediamtx-config: could not detect a non-loopback IPv4 address.");
  console.error("Hint: connect to a network (Wi‑Fi/Ethernet) or set webrtcAdditionalHosts manually.");
  process.exit(1);
}

const template = await fs.readFile(templatePath, "utf8");
// Put loopback first so local host-browser WHIP runs prefer deterministic candidates.
// Keep host aliases as fallback for environments where loopback isn't selected.
const additionalHostsLine = `webrtcAdditionalHosts: [ "127.0.0.1", "localhost", "host.docker.internal", "${hostIpv4}" ]`;

const output = /^webrtcAdditionalHosts:/m.test(template)
  ? template.replace(/^webrtcAdditionalHosts:.*$/m, additionalHostsLine)
  : `${template.trimEnd()}\n${additionalHostsLine}\n`;

await fs.writeFile(outputPath, output, "utf8");
console.log(`gen-mediamtx-config: wrote ${outputPath} (hostIpv4=${hostIpv4})`);
