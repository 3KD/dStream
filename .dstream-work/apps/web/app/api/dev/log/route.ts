import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

const LOG_PATH = process.env.DSTREAM_DEV_LOG_PATH ?? "/private/tmp/dstream-browser.log";

function devtoolsEnabled() {
  return process.env.NODE_ENV === "development" || process.env.DSTREAM_DEVTOOLS === "1";
}

function toLines(input: unknown): string[] {
  if (!input) return [];
  if (typeof input === "string") return [input];
  if (Array.isArray(input)) return input.filter((v) => typeof v === "string") as string[];
  if (typeof input === "object") {
    const obj = input as any;
    if (typeof obj.line === "string") return [obj.line];
    if (Array.isArray(obj.lines)) return obj.lines.filter((v: unknown) => typeof v === "string");
  }
  return [];
}

function tail(text: string, maxLines: number) {
  const lines = text.split("\n");
  const sliced = lines.slice(Math.max(0, lines.length - maxLines));
  return sliced.join("\n");
}

export async function GET() {
  if (!devtoolsEnabled()) return new NextResponse("Not Found", { status: 404 });

  try {
    const raw = await fs.readFile(LOG_PATH, "utf8");
    return new NextResponse(tail(raw, 400), {
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      return new NextResponse("", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return new NextResponse(String(e?.message ?? e), { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!devtoolsEnabled()) return new NextResponse("Not Found", { status: 404 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = null;
  }

  const lines = toLines(json);
  if (lines.length === 0) return NextResponse.json({ ok: true, appended: 0 });

  const ts = new Date().toISOString();
  const payload = lines.map((l) => `[${ts}] ${l}`).join("\n") + "\n";

  try {
    await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
    await fs.appendFile(LOG_PATH, payload, "utf8");
    return NextResponse.json({ ok: true, appended: lines.length, path: LOG_PATH });
  } catch (e: any) {
    return new NextResponse(String(e?.message ?? e), { status: 500 });
  }
}

export async function DELETE() {
  if (!devtoolsEnabled()) return new NextResponse("Not Found", { status: 404 });
  try {
    await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
    await fs.writeFile(LOG_PATH, "", "utf8");
    return NextResponse.json({ ok: true, cleared: true, path: LOG_PATH });
  } catch (e: any) {
    return new NextResponse(String(e?.message ?? e), { status: 500 });
  }
}
