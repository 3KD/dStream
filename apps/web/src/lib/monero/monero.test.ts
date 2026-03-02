import crypto from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { MoneroWalletRpcClient } from "./walletRpc";
import { findLatestIncomingTip } from "./tipVerify";
import { makeTipLabel, signTipSession, verifyTipSession } from "./tipSession";
import { signStakeSession, verifyStakeSession } from "./stakeSession";
import { getStakeTotals } from "./stakeVerify";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function tamperSigFirstChar(token: string): string {
  if (!token) return token;
  const parts = token.split(".");
  if (parts.length !== 2) return token;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return token;
  const first = sig[0] ?? "";
  const next = first === "A" ? "B" : "A";
  return `${payloadB64}.${next}${sig.slice(1)}`;
}

function rpcResult(id: any, result: any) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: any, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function makeFakeAddress(accountIndex: number, addressIndex: number): string {
  const seed = `dstream-mock:${accountIndex}:${addressIndex}`;
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  return `mockxmr_${hash.slice(0, 64)}`;
}

function makeTxid() {
  return crypto.randomBytes(32).toString("hex");
}

function toBigInt(value: string): bigint {
  if (!/^\d+$/.test(value)) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function createMockWalletRpcTransport() {
  const state = {
    addresses: new Map<number, Array<{ address: string; address_index: number; label: string }>>(),
    transfers: [] as Array<{
      amount: string;
      confirmations: number;
      txid: string;
      timestamp: number;
      subaddr_index: { major: number; minor: number };
      spent: boolean;
    }>,
    multisig: {
      prepared: false,
      exchangeCalls: 0
    }
  };

  function ensureAccount(accountIndex: number) {
    if (!state.addresses.has(accountIndex)) {
      state.addresses.set(accountIndex, [{ address: makeFakeAddress(accountIndex, 0), address_index: 0, label: "" }]);
    }
  }

  async function handleJsonRpc(method: string, params: any, id: any) {
    if (method === "get_version") return rpcResult(id, { version: 1 });

    if (method === "create_address") {
      const accountIndex = Number(params.account_index ?? 0);
      const label = typeof params.label === "string" ? params.label : "";
      if (!Number.isInteger(accountIndex) || accountIndex < 0) return rpcError(id, -32602, "invalid account_index");
      ensureAccount(accountIndex);
      const list = state.addresses.get(accountIndex)!;
      const nextIndex = list.length;
      const address = makeFakeAddress(accountIndex, nextIndex);
      list.push({ address, address_index: nextIndex, label });
      return rpcResult(id, { address, address_index: nextIndex });
    }

    if (method === "get_address") {
      const accountIndex = Number(params.account_index ?? 0);
      if (!Number.isInteger(accountIndex) || accountIndex < 0) return rpcError(id, -32602, "invalid account_index");
      ensureAccount(accountIndex);
      const list = state.addresses.get(accountIndex)!;
      return rpcResult(id, { address: list[0]!.address, addresses: list });
    }

    if (method === "get_transfers") {
      return rpcResult(id, { in: state.transfers, pending: [], pool: [] });
    }

    if (method === "get_balance") {
      const accountIndex = Number(params.account_index ?? 0);
      if (!Number.isInteger(accountIndex) || accountIndex < 0) return rpcError(id, -32602, "invalid account_index");

      const rawAddressIndices = Array.isArray(params.address_indices) ? params.address_indices : null;
      const addressIndices = rawAddressIndices
        ? rawAddressIndices.map((v: any) => Number(v)).filter((v: number) => Number.isInteger(v) && v >= 0)
        : null;
      const includeAddressIndex = (minor: number) => (addressIndices ? addressIndices.includes(minor) : true);

      let balance = 0n;
      let unlockedBalance = 0n;
      const perMap = new Map<number, { address_index: number; balance: bigint; unlocked_balance: bigint }>();

      for (const t of state.transfers) {
        if (t.subaddr_index.major !== accountIndex) continue;
        if (!includeAddressIndex(t.subaddr_index.minor)) continue;
        if (t.spent) continue;

        const amount = toBigInt(t.amount);
        balance += amount;
        if (t.confirmations > 0) unlockedBalance += amount;

        const row = perMap.get(t.subaddr_index.minor) ?? { address_index: t.subaddr_index.minor, balance: 0n, unlocked_balance: 0n };
        row.balance += amount;
        if (t.confirmations > 0) row.unlocked_balance += amount;
        perMap.set(t.subaddr_index.minor, row);
      }

      const perSub = Array.from(perMap.values())
        .sort((a, b) => a.address_index - b.address_index)
        .map((row) => ({
          address_index: row.address_index,
          balance: row.balance.toString(),
          unlocked_balance: row.unlocked_balance.toString()
        }));

      return rpcResult(id, {
        balance: balance.toString(),
        unlocked_balance: unlockedBalance.toString(),
        per_subaddress: perSub
      });
    }

    if (method === "sweep_all") {
      const accountIndex = Number(params.account_index ?? 0);
      const destination = typeof params.address === "string" ? params.address : "";
      const subaddrIndices = Array.isArray(params.subaddr_indices) ? params.subaddr_indices.map((v: number | string) => Number(v)) : [];

      if (!Number.isInteger(accountIndex) || accountIndex < 0) return rpcError(id, -32602, "invalid account_index");
      if (!destination.trim()) return rpcError(id, -32602, "invalid address");
      if (subaddrIndices.length === 0) return rpcError(id, -32602, "invalid subaddr_indices");

      const targets = new Set(subaddrIndices.filter((v: number) => Number.isInteger(v) && v >= 0));
      let amount = 0n;
      for (const t of state.transfers) {
        if (t.subaddr_index.major !== accountIndex) continue;
        if (!targets.has(t.subaddr_index.minor)) continue;
        if (t.spent) continue;
        if (t.confirmations <= 0) continue;
        amount += toBigInt(t.amount);
        t.spent = true;
      }

      if (amount <= 0n) return rpcResult(id, { tx_hash_list: [], amount_list: [] });
      return rpcResult(id, { tx_hash_list: [makeTxid()], amount_list: [amount.toString()] });
    }

    if (method === "prepare_multisig") {
      state.multisig.prepared = true;
      state.multisig.exchangeCalls = 0;
      return rpcResult(id, { multisig_info: `prepare:${crypto.randomBytes(10).toString("hex")}` });
    }

    if (method === "make_multisig") {
      const infos = Array.isArray(params?.multisig_info) ? params.multisig_info.map((v: any) => String(v || "").trim()).filter(Boolean) : [];
      const threshold = Number(params?.threshold ?? 0);
      if (infos.length === 0) return rpcError(id, -32602, "invalid multisig_info");
      if (!Number.isInteger(threshold) || threshold < 2) return rpcError(id, -32602, "invalid threshold");
      if (!state.multisig.prepared) return rpcError(id, -32000, "wallet not prepared for multisig");
      state.multisig.exchangeCalls = 0;
      return rpcResult(id, {
        address: makeFakeAddress(0, 9000),
        multisig_info: `exchange:1:${crypto.randomBytes(10).toString("hex")}`
      });
    }

    if (method === "exchange_multisig_keys") {
      const infos = Array.isArray(params?.multisig_info) ? params.multisig_info.map((v: any) => String(v || "").trim()).filter(Boolean) : [];
      if (infos.length === 0) return rpcError(id, -32602, "invalid multisig_info");
      if (!state.multisig.prepared) return rpcError(id, -32000, "wallet not prepared for multisig");
      state.multisig.exchangeCalls += 1;
      if (state.multisig.exchangeCalls >= 2) {
        return rpcResult(id, { address: makeFakeAddress(0, 9000), multisig_info: "" });
      }
      return rpcResult(id, {
        address: makeFakeAddress(0, 9000),
        multisig_info: `exchange:2:${crypto.randomBytes(10).toString("hex")}`
      });
    }

    if (method === "export_multisig_info") {
      if (!state.multisig.prepared) return rpcError(id, -32000, "wallet not prepared for multisig");
      return rpcResult(id, { info: `export:${crypto.randomBytes(10).toString("hex")}` });
    }

    if (method === "import_multisig_info") {
      const infos = Array.isArray(params?.info) ? params.info.map((v: any) => String(v || "").trim()).filter(Boolean) : [];
      if (infos.length === 0) return rpcError(id, -32602, "invalid info");
      return rpcResult(id, { n_outputs: infos.length * 2 });
    }

    if (method === "sign_multisig") {
      const txDataHex = typeof params?.tx_data_hex === "string" ? params.tx_data_hex.trim().toLowerCase() : "";
      if (!/^[0-9a-f]+$/.test(txDataHex)) return rpcError(id, -32602, "invalid tx_data_hex");
      return rpcResult(id, { tx_data_hex: `${txDataHex}aa`, tx_hash_list: [makeTxid()] });
    }

    if (method === "submit_multisig") {
      const txDataHex = typeof params?.tx_data_hex === "string" ? params.tx_data_hex.trim().toLowerCase() : "";
      if (!/^[0-9a-f]+$/.test(txDataHex)) return rpcError(id, -32602, "invalid tx_data_hex");
      return rpcResult(id, { tx_hash_list: [makeTxid()] });
    }

    if (method === "dstream_inject_transfer") {
      const accountIndex = Number(params.account_index ?? 0);
      const addressIndex = Number(params.address_index ?? 0);
      const amount = typeof params.amount === "string" ? params.amount : "";
      const confirmations = Number(params.confirmations ?? 0);
      const txid = typeof params.txid === "string" ? params.txid : makeTxid();
      const timestamp = Number(params.timestamp ?? nowSec());

      if (!Number.isInteger(accountIndex) || accountIndex < 0) return rpcError(id, -32602, "invalid account_index");
      if (!Number.isInteger(addressIndex) || addressIndex < 0) return rpcError(id, -32602, "invalid address_index");
      if (!amount || !/^\d+$/.test(amount)) return rpcError(id, -32602, "invalid amount");

      ensureAccount(accountIndex);
      const list = state.addresses.get(accountIndex)!;
      if (!list[addressIndex]) return rpcError(id, -32602, "unknown subaddress");

      state.transfers.push({
        amount,
        confirmations: Number.isFinite(confirmations) ? Math.max(0, Math.trunc(confirmations)) : 0,
        txid,
        timestamp: Number.isFinite(timestamp) ? Math.max(0, Math.trunc(timestamp)) : nowSec(),
        subaddr_index: { major: accountIndex, minor: addressIndex },
        spent: false
      });

      return rpcResult(id, { ok: true });
    }

    if (method === "dstream_reset") {
      state.addresses.clear();
      state.transfers = [];
      state.multisig.prepared = false;
      state.multisig.exchangeCalls = 0;
      return rpcResult(id, { ok: true });
    }

    return rpcError(id, -32601, `method not found: ${method}`);
  }

  const fetchImpl = (async (input: any, init?: any): Promise<Response> => {
    const url = typeof input === "string" ? input : input?.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (!url || !url.endsWith("/json_rpc") || method !== "POST") {
      return new Response("not found", { status: 404, headers: { "cache-control": "no-store" } });
    }

    const bodyText = typeof init?.body === "string" ? init.body : "";
    let req: any = null;
    try {
      req = JSON.parse(bodyText || "{}");
    } catch {
      return new Response(JSON.stringify({ error: "invalid json" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
      });
    }

    const id = req?.id ?? "0";
    const rpcMethod = typeof req?.method === "string" ? req.method : "";
    const params = req?.params ?? {};

    const out = await handleJsonRpc(rpcMethod, params, id);
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }) as any;

  return { origin: "http://mock", fetchImpl };
}

test("tipSession token signs/verifies and is tamper-evident", () => {
  const payload = {
    v: 1 as const,
    t: "xmr_tip_session" as const,
    streamPubkey: "ea42bad6b6e800397ab144e9a1b4dd4f5caa5229be5964ba48fd21d57f086af2",
    streamId: "live-20260206-0000",
    accountIndex: 0,
    addressIndex: 12,
    createdAtMs: Date.now(),
    nonce: "abc123"
  };

  const token = signTipSession(payload);
  const roundtrip = verifyTipSession(token);
  assert.deepEqual(roundtrip, payload);

  const tampered = tamperSigFirstChar(token);
  assert.equal(verifyTipSession(tampered), null);
});

test("wallet RPC client + findLatestIncomingTip selects latest and applies confirmations", async () => {
  const mock = createMockWalletRpcTransport();
  const client = new MoneroWalletRpcClient({ origin: mock.origin, fetchImpl: mock.fetchImpl });
  const version = await client.getVersion();
  assert.equal(typeof version.version, "number");

  const label = makeTipLabel({
    streamPubkey: "ea42bad6b6e800397ab144e9a1b4dd4f5caa5229be5964ba48fd21d57f086af2",
    streamId: "live-20260206-0000",
    nonce: "n"
  });
  const created = await client.createAddress({ accountIndex: 0, label });
  assert.ok(created.address.startsWith("mockxmr_"));
  assert.ok(Number.isInteger(created.addressIndex));

  const t0 = nowSec() - 10;
  await client.dstreamInjectTransfer({
    accountIndex: 0,
    addressIndex: created.addressIndex,
    amountAtomic: "1000000000000",
    confirmations: 0,
    timestampSec: t0
  });

  const first = await findLatestIncomingTip({
    client,
    accountIndex: 0,
    addressIndex: created.addressIndex,
    confirmationsRequired: 2
  });
  assert.ok(first);
  assert.equal(first.confirmed, false);
  assert.equal(first.amountAtomic, "1000000000000");

  const t1 = nowSec();
  await client.dstreamInjectTransfer({
    accountIndex: 0,
    addressIndex: created.addressIndex,
    amountAtomic: "2000000000000",
    confirmations: 3,
    timestampSec: t1
  });

  const second = await findLatestIncomingTip({
    client,
    accountIndex: 0,
    addressIndex: created.addressIndex,
    confirmationsRequired: 2
  });
  assert.ok(second);
  assert.equal(second.confirmed, true);
  assert.equal(second.amountAtomic, "2000000000000");
  assert.equal(second.confirmations, 3);
  assert.ok((second.observedAtMs ?? 0) >= t1 * 1000);
});

test("wallet RPC getBalance + sweepAll settles unlocked stake funds", async () => {
  const mock = createMockWalletRpcTransport();
  const client = new MoneroWalletRpcClient({ origin: mock.origin, fetchImpl: mock.fetchImpl });
  const created = await client.createAddress({ accountIndex: 0, label: "dstream_stake:test" });

  await client.dstreamInjectTransfer({
    accountIndex: 0,
    addressIndex: created.addressIndex,
    amountAtomic: "400000000000",
    confirmations: 0,
    timestampSec: nowSec() - 5
  });
  await client.dstreamInjectTransfer({
    accountIndex: 0,
    addressIndex: created.addressIndex,
    amountAtomic: "600000000000",
    confirmations: 8,
    timestampSec: nowSec() - 4
  });

  const before = await client.getBalance({ accountIndex: 0, addressIndices: [created.addressIndex] });
  assert.equal(before.balanceAtomic, "1000000000000");
  assert.equal(before.unlockedAtomic, "600000000000");
  assert.equal(before.perSubaddress.length, 1);

  const sweep = await client.sweepAll({
    accountIndex: 0,
    addressIndex: created.addressIndex,
    address: makeFakeAddress(0, 999)
  });
  assert.equal(sweep.amountAtomic, "600000000000");
  assert.ok(sweep.txids.length >= 1);

  const after = await client.getBalance({ accountIndex: 0, addressIndices: [created.addressIndex] });
  assert.equal(after.balanceAtomic, "400000000000");
  assert.equal(after.unlockedAtomic, "0");
});

test("stakeSession token signs/verifies and is tamper-evident", () => {
  const payload = {
    v: 1 as const,
    t: "xmr_stake_session" as const,
    streamPubkey: "ea42bad6b6e800397ab144e9a1b4dd4f5caa5229be5964ba48fd21d57f086af2",
    streamId: "live-20260206-0000",
    viewerPubkey: "4f6bba3a8f8d9d3a4e7b1c2d3e4f5061728394a5b6c7d8e9f001122334455667",
    accountIndex: 0,
    addressIndex: 12,
    createdAtMs: Date.now(),
    nonce: "abc123"
  };

  const token = signStakeSession(payload);
  const roundtrip = verifyStakeSession(token);
  assert.deepEqual(roundtrip, payload);

  const tampered = tamperSigFirstChar(token);
  assert.equal(verifyStakeSession(tampered), null);
});

test("getStakeTotals sums totals and confirmed totals", async () => {
  const mock = createMockWalletRpcTransport();
  const client = new MoneroWalletRpcClient({ origin: mock.origin, fetchImpl: mock.fetchImpl });
  const created = await client.createAddress({ accountIndex: 0, label: "dstream_stake:test" });

  const base = nowSec() - 30;
  await client.dstreamInjectTransfer({
    accountIndex: 0,
    addressIndex: created.addressIndex,
    amountAtomic: "1000000000000",
    confirmations: 0,
    timestampSec: base + 1
  });
  await client.dstreamInjectTransfer({
    accountIndex: 0,
    addressIndex: created.addressIndex,
    amountAtomic: "2000000000000",
    confirmations: 5,
    timestampSec: base + 2
  });
  await client.dstreamInjectTransfer({
    accountIndex: 0,
    addressIndex: created.addressIndex,
    amountAtomic: "3000000000000",
    confirmations: 1,
    timestampSec: base + 3
  });

  const totals = await getStakeTotals({
    client,
    accountIndex: 0,
    addressIndex: created.addressIndex,
    confirmationsRequired: 2
  });
  assert.equal(totals.totalAtomic, "6000000000000");
  assert.equal(totals.confirmedAtomic, "2000000000000");
  assert.equal(totals.transferCount, 3);
  assert.ok((totals.lastObservedAtMs ?? 0) >= (base + 3) * 1000);
});

test("wallet RPC probeMethods reports support vs method-not-found", async () => {
  const mock = createMockWalletRpcTransport();
  const client = new MoneroWalletRpcClient({ origin: mock.origin, fetchImpl: mock.fetchImpl });

  const probes = await client.probeMethods(["get_version", "create_address", "prepare_multisig", "not_a_real_method"]);
  const byMethod = new Map(probes.map((p) => [p.method, p]));

  assert.equal(byMethod.get("get_version")?.supported, true);
  assert.equal(byMethod.get("create_address")?.supported, true);
  assert.equal(byMethod.get("prepare_multisig")?.supported, true);
  assert.equal(byMethod.get("not_a_real_method")?.supported, false);
  assert.equal(byMethod.get("not_a_real_method")?.code, -32601);
});

test("wallet RPC probeMethods passive mode skips high-risk methods", async () => {
  const mock = createMockWalletRpcTransport();
  const client = new MoneroWalletRpcClient({ origin: mock.origin, fetchImpl: mock.fetchImpl });

  const probes = await client.probeMethods(["submit_multisig"], { mode: "passive" });
  assert.equal(probes.length, 1);
  assert.equal(probes[0]?.method, "submit_multisig");
  assert.equal(probes[0]?.supported, true);
  assert.match(String(probes[0]?.message ?? ""), /passive mode/i);
});

test("wallet RPC multisig helpers run full mock flow", async () => {
  const mock = createMockWalletRpcTransport();
  const client = new MoneroWalletRpcClient({ origin: mock.origin, fetchImpl: mock.fetchImpl });

  const prepared = await client.prepareMultisig();
  assert.ok(prepared.multisigInfo.startsWith("prepare:"));

  const made = await client.makeMultisig({
    multisigInfo: ["peer_prepare_a", "peer_prepare_b"],
    threshold: 2
  });
  assert.ok(made.address);
  assert.ok(made.multisigInfo);

  const exchange1 = await client.exchangeMultisigKeys({ multisigInfo: ["peer_exchange_a", "peer_exchange_b"] });
  assert.ok(exchange1.multisigInfo);
  const exchange2 = await client.exchangeMultisigKeys({ multisigInfo: ["peer_exchange2_a", "peer_exchange2_b"] });
  assert.equal(exchange2.multisigInfo, null);

  const exported = await client.exportMultisigInfo();
  assert.ok(exported.info.startsWith("export:"));

  const imported = await client.importMultisigInfo({ infos: [exported.info, "peer_export"] });
  assert.equal(imported.outputsImported, 4);

  const signed = await client.signMultisig({ txDataHex: "deadbeef" });
  assert.ok(signed.txDataHex.endsWith("aa"));
  assert.ok(signed.txids.length > 0);

  const submitted = await client.submitMultisig({ txDataHex: signed.txDataHex });
  assert.ok(submitted.txids.length > 0);
});
