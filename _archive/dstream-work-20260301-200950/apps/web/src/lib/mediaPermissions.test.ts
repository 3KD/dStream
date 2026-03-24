import assert from "node:assert/strict";
import test from "node:test";
import { toMediaCaptureErrorMessage } from "./mediaPermissions";

test("media permission: not allowed maps to explicit guidance", () => {
  const message = toMediaCaptureErrorMessage(
    { name: "NotAllowedError", message: "Permission denied" },
    { mode: "camera", includeAudio: true }
  );
  assert.match(message, /Permission denied/i);
  assert.match(message, /camera and microphone/i);
});

test("media permission: missing device maps to compatible-input guidance", () => {
  const message = toMediaCaptureErrorMessage(
    { name: "NotFoundError", message: "Requested device not found" },
    { mode: "camera", includeAudio: false }
  );
  assert.match(message, /No compatible input/i);
  assert.match(message, /camera/i);
});

test("media permission: unsupported constraints maps to downgrade guidance", () => {
  const message = toMediaCaptureErrorMessage(
    { name: "OverconstrainedError", message: "Cannot satisfy constraints" },
    { mode: "screen", includeAudio: true }
  );
  assert.match(message, /not supported/i);
  assert.match(message, /screen and microphone/i);
});

test("media permission: unknown errors fall back to original message", () => {
  const original = "Custom capture failure";
  const message = toMediaCaptureErrorMessage(
    { name: "UnknownError", message: original },
    { mode: "screen", includeAudio: false }
  );
  assert.equal(message, original);
});

test("media permission: empty unknown errors use generic fallback", () => {
  const message = toMediaCaptureErrorMessage({}, { mode: "camera", includeAudio: false });
  assert.equal(message, "Failed to start camera.");
});
