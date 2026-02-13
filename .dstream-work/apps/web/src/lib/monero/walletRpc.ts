export type WalletRpcConfig = {
  origin: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type WalletRpcMethodProbe = {
  method: string;
  supported: boolean;
  code: number | null;
  message: string;
};

export type WalletRpcProbeMode = "active" | "passive";

type JsonRpcSuccess<T> = { jsonrpc: "2.0"; id: string | number; result: T };
type JsonRpcError = { jsonrpc: "2.0"; id: string | number; error: { code: number; message: string; data?: any } };

export type MoneroSubaddrIndex = { major: number; minor: number };

export type MoneroIncomingTransfer = {
  amountAtomic: string;
  confirmations: number;
  subaddrIndex: MoneroSubaddrIndex;
  txid?: string;
  timestampSec?: number;
  spent?: boolean;
};

export type MoneroSubaddressBalance = {
  addressIndex: number;
  balanceAtomic: string;
  unlockedAtomic: string;
};

export type MoneroBalance = {
  balanceAtomic: string;
  unlockedAtomic: string;
  perSubaddress: MoneroSubaddressBalance[];
};

export type MoneroSweepResult = {
  txids: string[];
  amountAtomic: string;
};

export type MoneroPrepareMultisigResult = {
  multisigInfo: string;
};

export type MoneroMakeMultisigResult = {
  address: string | null;
  multisigInfo: string | null;
};

export type MoneroExchangeMultisigResult = {
  address: string | null;
  multisigInfo: string | null;
};

export type MoneroExportMultisigResult = {
  info: string;
};

export type MoneroImportMultisigResult = {
  outputsImported: number;
};

export type MoneroSignMultisigResult = {
  txDataHex: string;
  txids: string[];
};

export type MoneroSubmitMultisigResult = {
  txids: string[];
};

function normalizeOrigin(input: string): string {
  return input.trim().replace(/\/$/, "");
}

function authHeader(username: string, password: string): string {
  const raw = `${username}:${password}`;
  // Node: Buffer exists; browsers: this module is intended for server/route usage.
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

function parseDigitsString(value: any): string | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return String(Math.trunc(value));
  return null;
}

function sumDigitsStrings(values: string[]): string {
  let total = 0n;
  for (const v of values) {
    if (!/^\d+$/.test(v)) continue;
    try {
      total += BigInt(v);
    } catch {
      // ignore malformed amount
    }
  }
  return total.toString();
}

function parseNumber(value: any): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function parseSubaddrIndex(value: any): MoneroSubaddrIndex | null {
  if (!value || typeof value !== "object") return null;
  const major = parseNumber((value as any).major);
  const minor = parseNumber((value as any).minor);
  if (major === null || minor === null) return null;
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return null;
  if (major < 0 || minor < 0) return null;
  return { major, minor };
}

const PASSIVE_SKIP_METHODS = new Set([
  "sweep_all",
  "prepare_multisig",
  "make_multisig",
  "exchange_multisig_keys",
  "export_multisig_info",
  "import_multisig_info",
  "sign_multisig",
  "submit_multisig"
]);

function probeParamsFor(method: string): Record<string, any> {
  if (method === "create_address") return { account_index: 0, label: "dstream_probe" };
  if (method === "get_transfers") return { in: true };
  if (method === "get_balance") return { account_index: 0 };
  if (method === "sweep_all") return { account_index: 0, subaddr_indices: [0], address: "invalid" };
  if (method === "make_multisig") return { multisig_info: ["probe_info"], threshold: 2, password: "" };
  if (method === "exchange_multisig_keys") return { multisig_info: ["probe_exchange"], password: "" };
  if (method === "import_multisig_info") return { info: ["probe_import"] };
  if (method === "sign_multisig") return { tx_data_hex: "00" };
  if (method === "submit_multisig") return { tx_data_hex: "00" };
  return {};
}

class WalletRpcCallError extends Error {
  readonly code: number | null;
  readonly kind: "rpc" | "http" | "invalid";

  constructor(opts: { kind: "rpc" | "http" | "invalid"; message: string; code?: number | null }) {
    super(opts.message);
    this.name = "WalletRpcCallError";
    this.kind = opts.kind;
    this.code = opts.code ?? null;
  }
}

function normalizeIncomingTransfer(raw: any): MoneroIncomingTransfer | null {
  if (!raw || typeof raw !== "object") return null;
  const amountAtomic = parseDigitsString((raw as any).amount);
  if (!amountAtomic) return null;
  const confirmationsRaw = parseNumber((raw as any).confirmations) ?? 0;
  const confirmations = Number.isFinite(confirmationsRaw) ? Math.max(0, Math.trunc(confirmationsRaw)) : 0;
  const subaddrIndex = parseSubaddrIndex((raw as any).subaddr_index);
  if (!subaddrIndex) return null;
  const timestampSecRaw = parseNumber((raw as any).timestamp);
  const timestampSec = timestampSecRaw !== null && Number.isFinite(timestampSecRaw) ? Math.max(0, Math.trunc(timestampSecRaw)) : undefined;
  const txid = typeof (raw as any).txid === "string" ? (raw as any).txid : undefined;
  const spent = typeof (raw as any).spent === "boolean" ? (raw as any).spent : undefined;
  return { amountAtomic, confirmations, subaddrIndex, timestampSec, txid, spent };
}

export class MoneroWalletRpcClient {
  readonly origin: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: WalletRpcConfig) {
    this.origin = normalizeOrigin(cfg.origin);
    this.username = cfg.username?.trim() || undefined;
    this.password = cfg.password?.trim() || undefined;
    this.timeoutMs = cfg.timeoutMs ?? 5000;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private async call<T>(method: string, params?: any): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.username && this.password) headers.authorization = authHeader(this.username, this.password);

      const res = await this.fetchImpl(`${this.origin}/json_rpc`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: "0", method, params }),
        signal: controller.signal
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new WalletRpcCallError({
          kind: "http",
          code: res.status,
          message: `wallet rpc http ${res.status}${text ? `: ${text}` : ""}`
        });
      }

      const data = (await res.json().catch(() => null)) as JsonRpcSuccess<T> | JsonRpcError | null;
      if (!data || (data as any).jsonrpc !== "2.0") {
        throw new WalletRpcCallError({ kind: "invalid", message: "wallet rpc: invalid JSON-RPC response" });
      }
      if ("error" in data) {
        throw new WalletRpcCallError({
          kind: "rpc",
          code: data.error.code,
          message: `wallet rpc error ${data.error.code}: ${data.error.message}`
        });
      }
      return data.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getVersion(): Promise<{ version: number }> {
    const res = await this.call<any>("get_version");
    const version = parseNumber(res?.version) ?? 0;
    return { version };
  }

  async createAddress(opts: { accountIndex: number; label?: string }): Promise<{ address: string; addressIndex: number }> {
    const accountIndex = Math.trunc(opts.accountIndex);
    const result = await this.call<any>("create_address", { account_index: accountIndex, label: opts.label ?? "" });
    const address = typeof result?.address === "string" ? result.address : "";
    const addressIndex = parseNumber(result?.address_index);
    if (!address || addressIndex === null) throw new Error("wallet rpc: create_address returned invalid result");
    return { address, addressIndex: Math.trunc(addressIndex) };
  }

  async getAddress(opts: { accountIndex: number }): Promise<{ address: string; addresses: Array<{ address: string; addressIndex: number; label?: string }> }> {
    const accountIndex = Math.trunc(opts.accountIndex);
    const result = await this.call<any>("get_address", { account_index: accountIndex });
    const address = typeof result?.address === "string" ? result.address : "";
    const rawAddresses = Array.isArray(result?.addresses) ? result.addresses : [];
    const addresses = rawAddresses
      .map((a: any) => {
        const addr = typeof a?.address === "string" ? a.address : "";
        const idx = parseNumber(a?.address_index);
        if (!addr || idx === null) return null;
        const label = typeof a?.label === "string" && a.label.trim() ? a.label.trim() : undefined;
        return { address: addr, addressIndex: Math.trunc(idx), label };
      })
      .filter(Boolean) as Array<{ address: string; addressIndex: number; label?: string }>;

    if (!address) throw new Error("wallet rpc: get_address returned invalid result");
    return { address, addresses };
  }

  async getIncomingTransfers(): Promise<MoneroIncomingTransfer[]> {
    const result = await this.call<any>("get_transfers", {
      in: true,
      pending: true,
      pool: true
    });

    const combined = ([] as any[]).concat(result?.in ?? [], result?.pending ?? [], result?.pool ?? []);
    return combined.map(normalizeIncomingTransfer).filter(Boolean) as MoneroIncomingTransfer[];
  }

  async refresh(): Promise<void> {
    await this.call<any>("refresh", {});
  }

  async getBalance(opts: { accountIndex: number; addressIndices?: number[] }): Promise<MoneroBalance> {
    const accountIndex = Math.trunc(opts.accountIndex);
    const indices = (opts.addressIndices ?? [])
      .map((n) => Math.trunc(n))
      .filter((n) => Number.isInteger(n) && n >= 0);
    const hasIndices = indices.length > 0;
    const params: any = { account_index: accountIndex };
    if (hasIndices) params.address_indices = Array.from(new Set(indices));

    const result = await this.call<any>("get_balance", params);
    const balanceAtomic = parseDigitsString(result?.balance) ?? "0";
    const unlockedAtomic = parseDigitsString(result?.unlocked_balance) ?? "0";
    const rawPerSub = Array.isArray(result?.per_subaddress) ? result.per_subaddress : [];

    const perSubaddress = rawPerSub
      .map((entry: any) => {
        const addressIndex = parseNumber(entry?.address_index);
        const balance = parseDigitsString(entry?.balance);
        const unlocked = parseDigitsString(entry?.unlocked_balance);
        if (addressIndex === null || !Number.isInteger(addressIndex) || addressIndex < 0) return null;
        return {
          addressIndex: Math.trunc(addressIndex),
          balanceAtomic: balance ?? "0",
          unlockedAtomic: unlocked ?? "0"
        };
      })
      .filter(Boolean) as MoneroSubaddressBalance[];

    return { balanceAtomic, unlockedAtomic, perSubaddress };
  }

  async sweepAll(opts: { accountIndex: number; addressIndex: number; address: string; priority?: number }): Promise<MoneroSweepResult> {
    const accountIndex = Math.trunc(opts.accountIndex);
    const addressIndex = Math.trunc(opts.addressIndex);
    const address = opts.address.trim();
    if (!address) throw new Error("wallet rpc: sweep_all requires destination address");

    const params: any = {
      account_index: accountIndex,
      subaddr_indices: [addressIndex],
      address
    };
    if (typeof opts.priority === "number" && Number.isFinite(opts.priority)) params.priority = Math.trunc(opts.priority);

    const result = await this.call<any>("sweep_all", params);
    const txids = Array.isArray(result?.tx_hash_list) ? result.tx_hash_list.filter((v: any) => typeof v === "string") : [];
    const amountList = Array.isArray(result?.amount_list)
      ? result.amount_list.map((v: any) => parseDigitsString(v)).filter((v: string | null): v is string => !!v)
      : [];
    return { txids, amountAtomic: sumDigitsStrings(amountList) };
  }

  async prepareMultisig(): Promise<MoneroPrepareMultisigResult> {
    const result = await this.call<any>("prepare_multisig", {});
    const multisigInfo = typeof result?.multisig_info === "string" ? result.multisig_info.trim() : "";
    if (!multisigInfo) throw new Error("wallet rpc: prepare_multisig returned invalid result");
    return { multisigInfo };
  }

  async makeMultisig(opts: { multisigInfo: string[]; threshold: number; password?: string }): Promise<MoneroMakeMultisigResult> {
    const multisigInfo = (opts.multisigInfo ?? []).map((v) => v.trim()).filter(Boolean);
    if (multisigInfo.length === 0) throw new Error("wallet rpc: make_multisig requires multisigInfo");
    const threshold = Math.trunc(opts.threshold);
    if (!Number.isInteger(threshold) || threshold < 2) throw new Error("wallet rpc: make_multisig threshold must be >= 2");
    const result = await this.call<any>("make_multisig", {
      multisig_info: multisigInfo,
      threshold,
      password: opts.password ?? ""
    });
    const address = typeof result?.address === "string" && result.address.trim() ? result.address.trim() : null;
    const outInfo = typeof result?.multisig_info === "string" && result.multisig_info.trim() ? result.multisig_info.trim() : null;
    return { address, multisigInfo: outInfo };
  }

  async exchangeMultisigKeys(opts: { multisigInfo: string[]; password?: string }): Promise<MoneroExchangeMultisigResult> {
    const multisigInfo = (opts.multisigInfo ?? []).map((v) => v.trim()).filter(Boolean);
    if (multisigInfo.length === 0) throw new Error("wallet rpc: exchange_multisig_keys requires multisigInfo");
    const result = await this.call<any>("exchange_multisig_keys", {
      multisig_info: multisigInfo,
      password: opts.password ?? ""
    });
    const address = typeof result?.address === "string" && result.address.trim() ? result.address.trim() : null;
    const outInfo = typeof result?.multisig_info === "string" && result.multisig_info.trim() ? result.multisig_info.trim() : null;
    return { address, multisigInfo: outInfo };
  }

  async exportMultisigInfo(): Promise<MoneroExportMultisigResult> {
    const result = await this.call<any>("export_multisig_info", {});
    const info = typeof result?.info === "string" ? result.info.trim() : "";
    if (!info) throw new Error("wallet rpc: export_multisig_info returned invalid result");
    return { info };
  }

  async importMultisigInfo(opts: { infos: string[] }): Promise<MoneroImportMultisigResult> {
    const infos = (opts.infos ?? []).map((v) => v.trim()).filter(Boolean);
    if (infos.length === 0) throw new Error("wallet rpc: import_multisig_info requires infos");
    const result = await this.call<any>("import_multisig_info", { info: infos });
    const n = parseNumber(result?.n_outputs) ?? parseNumber(result?.n_outputs_imported) ?? 0;
    return { outputsImported: Math.max(0, Math.trunc(n)) };
  }

  async signMultisig(opts: { txDataHex: string }): Promise<MoneroSignMultisigResult> {
    const txDataHex = opts.txDataHex.trim();
    if (!txDataHex) throw new Error("wallet rpc: sign_multisig requires txDataHex");
    const result = await this.call<any>("sign_multisig", { tx_data_hex: txDataHex });
    const signed = typeof result?.tx_data_hex === "string" ? result.tx_data_hex.trim() : "";
    if (!signed) throw new Error("wallet rpc: sign_multisig returned invalid tx_data_hex");
    const txids = Array.isArray(result?.tx_hash_list) ? result.tx_hash_list.filter((v: any) => typeof v === "string") : [];
    return { txDataHex: signed, txids };
  }

  async submitMultisig(opts: { txDataHex: string }): Promise<MoneroSubmitMultisigResult> {
    const txDataHex = opts.txDataHex.trim();
    if (!txDataHex) throw new Error("wallet rpc: submit_multisig requires txDataHex");
    const result = await this.call<any>("submit_multisig", { tx_data_hex: txDataHex });
    const txids = Array.isArray(result?.tx_hash_list) ? result.tx_hash_list.filter((v: any) => typeof v === "string") : [];
    return { txids };
  }

  async probeMethods(methods: string[], opts?: { mode?: WalletRpcProbeMode }): Promise<WalletRpcMethodProbe[]> {
    const mode: WalletRpcProbeMode = opts?.mode === "active" ? "active" : "passive";
    const uniqueMethods = Array.from(
      new Set(
        methods
          .map((m) => m.trim())
          .filter(Boolean)
      )
    );

    const probes: WalletRpcMethodProbe[] = [];
    for (const method of uniqueMethods) {
      if (mode === "passive" && PASSIVE_SKIP_METHODS.has(method)) {
        probes.push({
          method,
          supported: true,
          code: null,
          message: "skipped in passive mode (assumed supported)"
        });
        continue;
      }
      try {
        await this.call<any>(method, probeParamsFor(method));
        probes.push({ method, supported: true, code: null, message: "ok" });
      } catch (err: any) {
        if (err instanceof WalletRpcCallError && err.kind === "rpc") {
          const code = err.code ?? null;
          probes.push({
            method,
            supported: code !== -32601,
            code,
            message: err.message
          });
          continue;
        }
        probes.push({
          method,
          supported: false,
          code: null,
          message: err?.message ? String(err.message) : "probe failed"
        });
      }
    }

    return probes;
  }

  // Mock-only helper (used by tests and dev tools).
  async dstreamInjectTransfer(opts: {
    accountIndex: number;
    addressIndex: number;
    amountAtomic: string;
    confirmations?: number;
    txid?: string;
    timestampSec?: number;
  }): Promise<{ ok: true }> {
    const result = await this.call<any>("dstream_inject_transfer", {
      account_index: Math.trunc(opts.accountIndex),
      address_index: Math.trunc(opts.addressIndex),
      amount: opts.amountAtomic,
      confirmations: opts.confirmations ?? 0,
      txid: opts.txid,
      timestamp: opts.timestampSec
    });
    if (!result || result.ok !== true) throw new Error("wallet rpc: inject failed");
    return { ok: true };
  }

  // Mock-only helper (used by tests and dev tools).
  async dstreamReset(): Promise<{ ok: true }> {
    const result = await this.call<any>("dstream_reset");
    if (!result || result.ok !== true) throw new Error("wallet rpc: reset failed");
    return { ok: true };
  }
}
