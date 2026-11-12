"use client";

import { useEffect, useRef, useState } from "react";
import NextImage from "next/image";
import { Check, RefreshCw, Upload } from "lucide-react";
import { manualThumbnailUrl, type StreamThumbnail, type ThumbnailMode } from "@/lib/streamThumbnail";
import { requestStreamThumbnail, thumbnailUpload, verifyThumbnailImage } from "@/lib/streamThumbnailClient";

interface Props {
  originStreamId: string;
  legacyImage?: string;
  legacyDisabled?: boolean;
  privateStream?: boolean;
  getCredential: () => Promise<string>;
  onChange: (originStreamId: string, state: StreamThumbnail) => void;
}

export function BroadcastThumbnail({ originStreamId, legacyImage, legacyDisabled, privateStream, getCredential, onChange }: Props) {
  const [state, setState] = useState<StreamThumbnail | null>(null);
  const [url, setUrl] = useState(legacyImage || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const action = useRef<AbortController | null>(null);
  useEffect(() => () => action.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    setState(null);
    const refresh = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      try {
        const token = await getCredential();
        if (controller.signal.aborted) return;
        const next = await requestStreamThumbnail({ originStreamId, token, body: { image: legacyImage, disabled: legacyDisabled, privateStream, generate: true }, signal: controller.signal });
        if (!controller.signal.aborted) {
          setState((previous) => previous && previous.revision > next.revision ? previous : next);
          onChange(originStreamId, next); setError(next.warning || null);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Thumbnail is unavailable; retrying.");
      } finally { running = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [originStreamId, legacyImage, legacyDisabled, privateStream, getCredential, onChange, refreshNonce]);

  const save = async (body: { mode: ThumbnailMode; image?: string; privateCaptureAllowed?: boolean } | Blob) => {
    if (!state || busy) return;
    const scope = originStreamId;
    const controller = new AbortController();
    action.current?.abort(); action.current = controller;
    setBusy(true); setError(null);
    try {
      const prepared = body instanceof File ? await thumbnailUpload(body) : body;
      if (!(prepared instanceof Blob) && prepared.image) await verifyThumbnailImage(prepared.image, controller.signal);
      if (controller.signal.aborted) return;
      const token = await getCredential();
      if (controller.signal.aborted) return;
      const next = await requestStreamThumbnail({ originStreamId: scope, token, method: "PUT", revision: state.revision, body: prepared, signal: controller.signal });
      if (!controller.signal.aborted) { setState((previous) => previous && previous.revision > next.revision ? previous : next); onChange(scope, next); }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Thumbnail update failed."); }
    finally { if (action.current === controller) { action.current = null; if (!controller.signal.aborted) setBusy(false); } }
  };

  return (
    <div className="space-y-2">
      <label className="text-xs text-neutral-400" htmlFor="thumbnail-mode">Stream thumbnail</label>
      <select id="thumbnail-mode" value={state?.mode || "automatic"} disabled={!state || busy}
        onChange={(event) => { if (event.target.value !== "manual") void save({ mode: event.target.value as ThumbnailMode }); }}
        className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm">
        <option value="automatic">Automatic video frame</option>
        <option value="manual" disabled>Custom image (upload or paste below)</option>
        <option value="off">No public thumbnail</option>
      </select>
      {state?.privateStream && state.mode === "automatic" ? <label className="flex items-start gap-2 text-xs text-neutral-300">
        <input type="checkbox" checked={state.privateCaptureAllowed} disabled={busy} className="mt-0.5"
          onChange={(event) => void save({ mode: "automatic", privateCaptureAllowed: event.target.checked })} />
        Allow a public frame from this private stream
      </label> : null}
      <div className="flex gap-2">
        <input aria-label="Public thumbnail URL" value={url} disabled={busy} onChange={(event) => setUrl(event.target.value)} type="url" placeholder="https://..."
          className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm" />
        <button type="button" title="Use image URL" aria-label="Use image URL" disabled={!state || busy || !url.trim()}
          onClick={() => {
            try {
              const image = manualThumbnailUrl(url);
              void save({ mode: "manual", image });
            } catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid image URL."); }
          }} className="h-10 w-10 shrink-0 rounded-lg border border-neutral-700 p-2 disabled:opacity-40"><Check className="h-5 w-5" /></button>
        <label title="Upload thumbnail" aria-label="Upload thumbnail" className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-neutral-700">
          <Upload className="h-5 w-5" />
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!state || busy} className="sr-only" onChange={(event) => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (file) void save(file);
          }} />
        </label>
      </div>
      <p className="text-xs text-neutral-500">16:9 recommended, 1280 x 720. JPEG, PNG or WebP, up to 8 MiB. Thumbnails are public, including on private streams.</p>
      {state?.imageUrl ? <NextImage unoptimized width={640} height={360} src={state.imageUrl} key={state.revision} alt="Stream thumbnail"
        onError={() => setError("The public cover could not be loaded. Its saved choice is retained; check the image URL or retry.")}
        className="aspect-video w-full max-w-80 rounded-lg object-contain bg-black" /> : null}
      <p className="text-xs text-neutral-400" role="status">{busy ? "Saving thumbnail..." : state?.source === "pending" ? state.mode === "manual" ? "Custom thumbnail needs a valid image; a dStream fallback is shown." : state.privateStream && !state.privateCaptureAllowed ? "Private video is not captured without your public-frame permission. A dStream fallback is shown." : "Waiting for decodable video. A dStream fallback is shown until the first frame is ready; failed attempts retry." : state?.source === "generated" ? "Video thumbnail ready" : state?.source === "manual" ? "Custom thumbnail retained" : state?.source === "off" ? "Public thumbnail disabled" : "Loading thumbnail settings..."}</p>
      {error ? <p className="text-xs text-red-300" role="alert">{error} <button title="Retry thumbnail settings" aria-label="Retry thumbnail settings" type="button" onClick={() => setRefreshNonce((value) => value + 1)}><RefreshCw className="inline h-3 w-3" /></button></p> : null}
    </div>
  );
}
