export const STREAM_CHAT_CLEAR_REASON = "chat_window_clear_v1";

export function isStreamChatClearReason(reason: string | null | undefined): boolean {
  return typeof reason === "string" && reason.trim() === STREAM_CHAT_CLEAR_REASON;
}
