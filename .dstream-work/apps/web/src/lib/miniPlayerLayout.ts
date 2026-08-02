export const MINI_PLAYER_MIN_WIDTH = 240;
export const MINI_PLAYER_MAX_WIDTH = 960;
export const MINI_PLAYER_DEFAULT_WIDTH = 320;
export const MINI_PLAYER_VIEWPORT_GAP = 24;

export interface MiniPlayerViewport {
  width: number;
  height: number;
  offsetLeft?: number;
  offsetTop?: number;
}

export interface MiniPlayerPosition {
  x: number;
  y: number;
}

export function miniPlayerHeight(width: number): number {
  return Math.round((width * 9) / 16);
}

export function clampMiniPlayerWidth(
  width: number,
  viewport?: MiniPlayerViewport,
  gap = MINI_PLAYER_VIEWPORT_GAP
): number {
  const requested = Number.isFinite(width) ? Math.round(width) : MINI_PLAYER_DEFAULT_WIDTH;
  const normalWidth = Math.max(MINI_PLAYER_MIN_WIDTH, Math.min(MINI_PLAYER_MAX_WIDTH, requested));
  if (!viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) return normalWidth;

  const availableWidth = Math.max(1, Math.floor(viewport.width - gap * 2));
  const availableHeightAsWidth = Math.max(1, Math.floor((viewport.height - gap * 2) * (16 / 9)));
  return Math.max(1, Math.min(normalWidth, availableWidth, availableHeightAsWidth));
}

export function clampMiniPlayerPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewport: MiniPlayerViewport,
  gap = MINI_PLAYER_VIEWPORT_GAP
): MiniPlayerPosition {
  const offsetLeft = Number.isFinite(viewport.offsetLeft) ? Number(viewport.offsetLeft) : 0;
  const offsetTop = Number.isFinite(viewport.offsetTop) ? Number(viewport.offsetTop) : 0;
  const minX = offsetLeft + gap;
  const minY = offsetTop + gap;
  const maxX = Math.max(minX, offsetLeft + viewport.width - width - gap);
  const maxY = Math.max(minY, offsetTop + viewport.height - height - gap);
  const requestedX = Number.isFinite(x) ? x : minX;
  const requestedY = Number.isFinite(y) ? y : minY;

  return {
    x: Math.max(minX, Math.min(maxX, requestedX)),
    y: Math.max(minY, Math.min(maxY, requestedY))
  };
}
