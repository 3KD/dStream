import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeOrigin(input: string | undefined, fallback: string): string {
  const raw = (input ?? "").trim();
  const base = raw || fallback;
  return base.replace(/\/$/, "");
}

const MANIFEST_ORIGIN = normalizeOrigin(process.env.DSTREAM_MANIFEST_ORIGIN, "http://manifest:3001");

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const upstream = await fetch(`${MANIFEST_ORIGIN}/identity`, { cache: "no-store" });
    if (!upstream.ok) return new Response("manifest service unavailable", { status: 404 });
    const text = await upstream.text();
    return new Response(text, { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
  } catch (err: any) {
    const message = `manifest identity error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

