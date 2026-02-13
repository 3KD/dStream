import { getXmrConfirmationsRequired, getXmrWalletRpcAccountIndex, getXmrWalletRpcClient } from "@/lib/monero/server";
import type { WalletRpcProbeMode } from "@/lib/monero/walletRpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROFILE_METHODS = {
  tip_v1: ["get_version", "create_address", "get_transfers"],
  stake_v2: ["get_version", "create_address", "get_transfers", "get_balance", "sweep_all"],
  escrow_v3_multisig: [
    "get_version",
    "create_address",
    "get_transfers",
    "get_balance",
    "sweep_all",
    "prepare_multisig",
    "make_multisig",
    "exchange_multisig_keys",
    "export_multisig_info",
    "import_multisig_info",
    "sign_multisig",
    "submit_multisig"
  ]
} as const;

type ProfileName = keyof typeof PROFILE_METHODS;

function evaluateProfile(profileName: ProfileName, supportedByMethod: Map<string, boolean>) {
  const required = PROFILE_METHODS[profileName];
  const missing = required.filter((method) => !supportedByMethod.get(method));
  return {
    ready: missing.length === 0,
    required,
    missing
  };
}

export async function GET(req: Request): Promise<Response> {
  const client = getXmrWalletRpcClient();
  if (!client) return new Response("xmr wallet rpc not configured", { status: 404 });

  try {
    const url = new URL(req.url);
    const modeRaw = (url.searchParams.get("mode") || "").trim().toLowerCase();
    const probeMode: WalletRpcProbeMode = modeRaw === "active" ? "active" : "passive";
    const version = await client.getVersion();

    const methodList = Array.from(
      new Set(Object.values(PROFILE_METHODS).flatMap((methods) => methods))
    );
    const probes = await client.probeMethods(methodList, { mode: probeMode });

    const supportedByMethod = new Map<string, boolean>();
    for (const probe of probes) supportedByMethod.set(probe.method, probe.supported);

    const profiles = {
      tip_v1: evaluateProfile("tip_v1", supportedByMethod),
      stake_v2: evaluateProfile("stake_v2", supportedByMethod),
      escrow_v3_multisig: evaluateProfile("escrow_v3_multisig", supportedByMethod)
    };

    const methods = Object.fromEntries(
      probes.map((probe) => [
        probe.method,
        { supported: probe.supported, code: probe.code, message: probe.message }
      ])
    );

    return Response.json({
      ok: true,
      probeMode,
      version: version.version,
      accountIndex: getXmrWalletRpcAccountIndex(),
      confirmationsRequired: getXmrConfirmationsRequired(),
      profiles,
      methods
    });
  } catch (err: any) {
    const message = `xmr capability probe error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
