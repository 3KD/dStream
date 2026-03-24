import http from "node:http";
import crypto from "node:crypto";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text)
  });
  res.end(text);
}

function makeFakeAddress(accountIndex, addressIndex) {
  // Not a real Monero address; only used for local tests/dev.
  const seed = `dstream-mock:${accountIndex}:${addressIndex}`;
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  return `mockxmr_${hash.slice(0, 64)}`;
}

function makeTxid() {
  return crypto.randomBytes(32).toString("hex");
}

const state = {
  // accountIndex -> [{ address, address_index, label }]
  addresses: new Map(),
  // incoming transfers
  transfers: [],
  multisig: {
    prepared: false,
    exchangeCalls: 0
  }
};

function toBigInt(value) {
  if (!/^\d+$/.test(String(value ?? ""))) return 0n;
  try {
    return BigInt(String(value));
  } catch {
    return 0n;
  }
}

function ensureAccount(accountIndex) {
  if (!state.addresses.has(accountIndex)) {
    state.addresses.set(accountIndex, [{ address: makeFakeAddress(accountIndex, 0), address_index: 0, label: "" }]);
  }
}

function makeMockMultisigInfo(prefix) {
  return `${prefix}:${crypto.randomBytes(12).toString("hex")}`;
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleJsonRpc(req, res) {
  const body = await readJson(req);
  const id = body?.id ?? "0";
  const method = body?.method;
  const params = body?.params ?? {};

  if (method === "get_version") {
    return json(res, 200, rpcResult(id, { version: 65536 }));
  }

  if (method === "create_address") {
    const accountIndex = Number(params.account_index ?? 0);
    const label = String(params.label ?? "");
    if (!Number.isInteger(accountIndex) || accountIndex < 0) return json(res, 200, rpcError(id, -32602, "invalid account_index"));
    ensureAccount(accountIndex);
    const list = state.addresses.get(accountIndex);
    const nextIndex = list.length;
    const address = makeFakeAddress(accountIndex, nextIndex);
    list.push({ address, address_index: nextIndex, label });
    return json(res, 200, rpcResult(id, { address, address_index: nextIndex }));
  }

  if (method === "get_address") {
    const accountIndex = Number(params.account_index ?? 0);
    if (!Number.isInteger(accountIndex) || accountIndex < 0) return json(res, 200, rpcError(id, -32602, "invalid account_index"));
    ensureAccount(accountIndex);
    const list = state.addresses.get(accountIndex);
    return json(res, 200, rpcResult(id, { address: list[0].address, addresses: list }));
  }

  if (method === "get_transfers") {
    // We only support inbound transfers. Split by confirmations into "pool" (0) and "in" (>0).
    const ins = [];
    const pool = [];
    for (const t of state.transfers) {
      if (t.confirmations > 0) ins.push(t);
      else pool.push(t);
    }
    return json(res, 200, rpcResult(id, { in: ins, pool }));
  }

  if (method === "get_balance") {
    const accountIndex = Number(params.account_index ?? 0);
    if (!Number.isInteger(accountIndex) || accountIndex < 0) return json(res, 200, rpcError(id, -32602, "invalid account_index"));

    const rawAddressIndices = Array.isArray(params.address_indices) ? params.address_indices : null;
    const addressIndices = rawAddressIndices
      ? rawAddressIndices.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= 0)
      : null;
    const includeAddressIndex = (minor) => (addressIndices ? addressIndices.includes(minor) : true);

    let total = 0n;
    let unlocked = 0n;
    const perMap = new Map();

    for (const t of state.transfers) {
      if (t.subaddr_index.major !== accountIndex) continue;
      if (!includeAddressIndex(t.subaddr_index.minor)) continue;
      if (t.spent) continue;

      const amt = toBigInt(t.amount);
      total += amt;
      if (t.confirmations > 0) unlocked += amt;

      const key = t.subaddr_index.minor;
      const row = perMap.get(key) ?? { address_index: key, balance: 0n, unlocked_balance: 0n };
      row.balance += amt;
      if (t.confirmations > 0) row.unlocked_balance += amt;
      perMap.set(key, row);
    }

    const per_subaddress = Array.from(perMap.values())
      .sort((a, b) => a.address_index - b.address_index)
      .map((row) => ({
        address_index: row.address_index,
        balance: row.balance.toString(),
        unlocked_balance: row.unlocked_balance.toString()
      }));

    return json(res, 200, rpcResult(id, { balance: total.toString(), unlocked_balance: unlocked.toString(), per_subaddress }));
  }

  if (method === "sweep_all") {
    const accountIndex = Number(params.account_index ?? 0);
    const destination = String(params.address ?? "");
    const subaddrIndices = Array.isArray(params.subaddr_indices) ? params.subaddr_indices.map((v) => Number(v)) : [];
    const targetSet = new Set(subaddrIndices.filter((v) => Number.isInteger(v) && v >= 0));

    if (!Number.isInteger(accountIndex) || accountIndex < 0) return json(res, 200, rpcError(id, -32602, "invalid account_index"));
    if (!destination.trim()) return json(res, 200, rpcError(id, -32602, "invalid address"));
    if (targetSet.size === 0) return json(res, 200, rpcError(id, -32602, "invalid subaddr_indices"));

    let swept = 0n;
    for (const t of state.transfers) {
      if (t.subaddr_index.major !== accountIndex) continue;
      if (!targetSet.has(t.subaddr_index.minor)) continue;
      if (t.spent) continue;
      if (t.confirmations <= 0) continue;

      swept += toBigInt(t.amount);
      t.spent = true;
    }

    if (swept <= 0n) return json(res, 200, rpcResult(id, { tx_hash_list: [], amount_list: [] }));
    const txid = makeTxid();
    return json(res, 200, rpcResult(id, { tx_hash_list: [txid], amount_list: [swept.toString()] }));
  }

  if (method === "prepare_multisig") {
    state.multisig.prepared = true;
    state.multisig.exchangeCalls = 0;
    return json(res, 200, rpcResult(id, { multisig_info: makeMockMultisigInfo("prepare") }));
  }

  if (method === "make_multisig") {
    const infos = Array.isArray(params.multisig_info) ? params.multisig_info.map((v) => String(v || "").trim()).filter(Boolean) : [];
    const threshold = Number(params.threshold ?? 0);
    if (infos.length === 0) return json(res, 200, rpcError(id, -32602, "invalid multisig_info"));
    if (!Number.isInteger(threshold) || threshold < 2) return json(res, 200, rpcError(id, -32602, "invalid threshold"));
    if (!state.multisig.prepared) return json(res, 200, rpcError(id, -32000, "wallet not prepared for multisig"));
    state.multisig.exchangeCalls = 0;
    return json(res, 200, rpcResult(id, { address: makeFakeAddress(0, 9000), multisig_info: makeMockMultisigInfo("exchange-1") }));
  }

  if (method === "exchange_multisig_keys") {
    const infos = Array.isArray(params.multisig_info) ? params.multisig_info.map((v) => String(v || "").trim()).filter(Boolean) : [];
    if (infos.length === 0) return json(res, 200, rpcError(id, -32602, "invalid multisig_info"));
    if (!state.multisig.prepared) return json(res, 200, rpcError(id, -32000, "wallet not prepared for multisig"));
    state.multisig.exchangeCalls += 1;
    if (state.multisig.exchangeCalls >= 2) {
      return json(res, 200, rpcResult(id, { address: makeFakeAddress(0, 9000), multisig_info: "" }));
    }
    return json(res, 200, rpcResult(id, { address: makeFakeAddress(0, 9000), multisig_info: makeMockMultisigInfo("exchange-2") }));
  }

  if (method === "export_multisig_info") {
    if (!state.multisig.prepared) return json(res, 200, rpcError(id, -32000, "wallet not prepared for multisig"));
    return json(res, 200, rpcResult(id, { info: makeMockMultisigInfo("export") }));
  }

  if (method === "import_multisig_info") {
    const infos = Array.isArray(params.info) ? params.info.map((v) => String(v || "").trim()).filter(Boolean) : [];
    if (infos.length === 0) return json(res, 200, rpcError(id, -32602, "invalid info"));
    return json(res, 200, rpcResult(id, { n_outputs: infos.length * 2 }));
  }

  if (method === "sign_multisig") {
    const txDataHex = String(params.tx_data_hex ?? "").trim();
    if (!/^[0-9a-f]+$/i.test(txDataHex)) return json(res, 200, rpcError(id, -32602, "invalid tx_data_hex"));
    const signed = `${txDataHex.toLowerCase()}aa`;
    return json(res, 200, rpcResult(id, { tx_data_hex: signed, tx_hash_list: [makeTxid()] }));
  }

  if (method === "submit_multisig") {
    const txDataHex = String(params.tx_data_hex ?? "").trim();
    if (!/^[0-9a-f]+$/i.test(txDataHex)) return json(res, 200, rpcError(id, -32602, "invalid tx_data_hex"));
    return json(res, 200, rpcResult(id, { tx_hash_list: [makeTxid()] }));
  }

  if (method === "dstream_inject_transfer") {
    const accountIndex = Number(params.account_index ?? 0);
    const addressIndex = Number(params.address_index ?? 0);
    const amount = String(params.amount ?? "");
    const confirmations = Number(params.confirmations ?? 0);
    const txid = params.txid ? String(params.txid) : makeTxid();
    const timestamp = Number(params.timestamp ?? nowSec());

    if (!/^\d+$/.test(amount)) return json(res, 200, rpcError(id, -32602, "invalid amount"));
    if (!Number.isInteger(accountIndex) || accountIndex < 0) return json(res, 200, rpcError(id, -32602, "invalid account_index"));
    if (!Number.isInteger(addressIndex) || addressIndex < 0) return json(res, 200, rpcError(id, -32602, "invalid address_index"));
    if (!Number.isInteger(confirmations) || confirmations < 0) return json(res, 200, rpcError(id, -32602, "invalid confirmations"));

    ensureAccount(accountIndex);
    const list = state.addresses.get(accountIndex);
    if (!list[addressIndex]) return json(res, 200, rpcError(id, -32602, "unknown subaddress"));

    state.transfers.push({
      amount,
      confirmations,
      txid,
      timestamp,
      subaddr_index: { major: accountIndex, minor: addressIndex },
      spent: false
    });

    return json(res, 200, rpcResult(id, { ok: true }));
  }

  if (method === "dstream_reset") {
    state.addresses.clear();
    state.transfers = [];
    state.multisig.prepared = false;
    state.multisig.exchangeCalls = 0;
    return json(res, 200, rpcResult(id, { ok: true }));
  }

  return json(res, 200, rpcError(id, -32601, `method not found: ${method}`));
}

const port = Number(process.env.XMR_MOCK_HTTP_PORT || "18083");

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, t: "dstream_monero_mock", version: 1 });
  }

  if (req.method === "POST" && url.pathname === "/json_rpc") {
    handleJsonRpc(req, res).catch((e) => json(res, 500, { error: String(e?.message ?? e) }));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end("not found");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[xmr-mock] listening on :${port}`);
});
