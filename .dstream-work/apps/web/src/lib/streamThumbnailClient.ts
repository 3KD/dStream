import type { StreamThumbnail, ThumbnailMode } from "./streamThumbnail";

export async function requestStreamThumbnail(input: {
  originStreamId: string;
  token: string;
  method?: "GET" | "POST" | "PUT";
  body?: { image?: string; disabled?: boolean; active?: boolean; generate?: boolean; mode?: ThumbnailMode; privateStream?: boolean; privateCaptureAllowed?: boolean } | Blob;
  revision?: number;
  signal?: AbortSignal;
}): Promise<StreamThumbnail> {
  const body = input.body instanceof Blob ? input.body : input.body ? JSON.stringify(input.body) : undefined;
  const response = await fetch(`/api/broadcast/thumbnail/${encodeURIComponent(input.originStreamId)}`, {
    method: input.method || "POST", cache: "no-store", signal: input.signal,
    headers: { authorization: `Bearer ${input.token}`, "content-type": input.body instanceof Blob ? "image/jpeg" : "application/json",
      ...(input.revision ? { "x-thumbnail-revision": String(input.revision) } : {}) }, body
  });
  const result = await response.json();
  if (!response.ok || !result) throw new Error(typeof result?.error === "string" ? result.error : "Thumbnail settings are unavailable.");
  return result as StreamThumbnail;
}

export async function thumbnailUpload(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
    throw new Error("Choose a JPEG, PNG or WebP image up to 8 MiB.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width < 1 || bitmap.height < 1) throw new Error("Image dimensions must be between 1 and 8192 pixels.");
    const canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion is unavailable.");
    const scale = Math.min(640 / bitmap.width, 360 / bitmap.height);
    const width = bitmap.width * scale, height = bitmap.height * scale;
    context.fillStyle = "#000000"; context.fillRect(0, 0, 640, 360);
    context.drawImage(bitmap, (640 - width) / 2, (360 - height) / 2, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Image conversion failed.")), "image/jpeg", 0.85));
  } finally { bitmap.close(); }
}

export function verifyThumbnailImage(url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (error?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      image.onload = null; image.onerror = null;
      if (error) { image.removeAttribute("src"); reject(error); } else resolve();
    };
    const abort = () => finish(new Error("Thumbnail check cancelled."));
    const timer = setTimeout(() => finish(new Error("The public image did not load within five seconds. Upload it instead or check its HTTPS URL.")), 5000);
    image.onload = () => finish();
    image.onerror = () => finish(new Error("This public image could not be loaded. Upload it instead or check its HTTPS URL."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort(); else image.src = url;
  });
}
