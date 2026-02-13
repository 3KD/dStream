import { getXmrWalletRpcClient, getXmrConfirmationsRequired, getXmrWalletRpcAccountIndex } from "@/lib/monero/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const client = getXmrWalletRpcClient();
  if (!client) return new Response("xmr wallet rpc not configured", { status: 404 });

  try {
    const version = await client.getVersion();
    return Response.json({
      ok: true,
      version: version.version,
      accountIndex: getXmrWalletRpcAccountIndex(),
      confirmationsRequired: getXmrConfirmationsRequired()
    });
  } catch (err: any) {
    const message = `xmr wallet rpc error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

