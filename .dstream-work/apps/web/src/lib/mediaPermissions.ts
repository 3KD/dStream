type CaptureMode = "camera" | "screen";

function modeLabel(mode: CaptureMode, includeAudio: boolean): string {
  if (mode === "screen") return includeAudio ? "screen and microphone" : "screen";
  return includeAudio ? "camera and microphone" : "camera";
}

export function toMediaCaptureErrorMessage(
  error: unknown,
  opts: { mode: CaptureMode; includeAudio: boolean }
): string {
  const anyError = (error ?? {}) as { name?: string; message?: string };
  const name = String(anyError.name ?? "").trim();
  const message = String(anyError.message ?? "").trim();
  const target = modeLabel(opts.mode, opts.includeAudio);

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return `Permission denied for ${target}. Allow access in browser and OS settings, then retry.`;
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return `No compatible input found for ${target}. Connect/select the device and retry.`;
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return `The ${target} device appears busy. Close other apps using it and retry.`;
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return `Selected ${target} settings are not supported on this device. Lower quality or reselect devices.`;
  }
  if (name === "SecurityError") {
    return `Secure context required for ${target}. Use HTTPS (or localhost) and retry.`;
  }
  if (name === "AbortError") {
    return `Capture request for ${target} was interrupted. Retry.`;
  }
  if (name === "TypeError") {
    return `This browser cannot start ${target} with the current constraints.`;
  }

  if (message.length > 0) return message;
  return `Failed to start ${target}.`;
}
