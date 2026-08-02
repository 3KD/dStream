import assert from "node:assert/strict";
import test from "node:test";
import {
  clampMiniPlayerPosition,
  clampMiniPlayerWidth,
  miniPlayerHeight
} from "./miniPlayerLayout";

test("keeps a persisted mini player fully inside the viewport", () => {
  const viewport = { width: 1440, height: 900 };
  const width = clampMiniPlayerWidth(320, viewport);
  const height = miniPlayerHeight(width);
  const position = clampMiniPlayerPosition(1400, 880, width, height, viewport);

  assert.deepEqual(position, { x: 1096, y: 696 });
  assert.equal(position.x + width, viewport.width - 24);
  assert.equal(position.y + height, viewport.height - 24);
});

test("shrinks the default dock to fit a narrow mobile viewport", () => {
  const viewport = { width: 320, height: 568 };
  const width = clampMiniPlayerWidth(320, viewport);
  const height = miniPlayerHeight(width);
  const position = clampMiniPlayerPosition(24, 500, width, height, viewport);

  assert.equal(width, 272);
  assert.deepEqual(position, { x: 24, y: 391 });
});

test("accounts for a shifted visual viewport", () => {
  const viewport = { width: 800, height: 600, offsetLeft: 80, offsetTop: 40 };
  const position = clampMiniPlayerPosition(-100, -100, 320, 180, viewport);

  assert.deepEqual(position, { x: 104, y: 64 });
});
