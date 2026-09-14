export const CHAT_NOTIFICATION_SOUND_STORAGE_KEY = "dstream.chat.notification-sound.v1";

export interface ChatNotificationMessage {
  id?: string;
  pubkey: string;
  createdAt: number;
  content: string;
}

function notificationMessageKey(message: ChatNotificationMessage): string {
  return message.id || `${message.pubkey}:${message.createdAt}:${message.content}`;
}

export function readChatNotificationSoundPreference(storage: Storage | null): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(CHAT_NOTIFICATION_SOUND_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeChatNotificationSoundPreference(storage: Storage | null, enabled: boolean): void {
  if (!storage) return;
  try {
    storage.setItem(CHAT_NOTIFICATION_SOUND_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

export function collectNewChatNotificationMessages(input: {
  messages: ChatNotificationMessage[];
  seenIds: Set<string>;
  viewerPubkey: string | null;
  activeSinceMs: number;
}): ChatNotificationMessage[] {
  const viewerPubkey = input.viewerPubkey?.trim().toLowerCase() ?? null;
  const notifications: ChatNotificationMessage[] = [];

  for (const message of input.messages) {
    const key = notificationMessageKey(message);
    if (input.seenIds.has(key)) continue;
    input.seenIds.add(key);

    if (viewerPubkey && message.pubkey.trim().toLowerCase() === viewerPubkey) continue;

    // Nostr timestamps have one-second precision. Include a message from the
    // mounting second, but never replay older relay history as a notification.
    const messageLatestPossibleMs = Math.floor(message.createdAt) * 1_000 + 999;
    if (messageLatestPossibleMs < input.activeSinceMs) continue;
    notifications.push(message);
  }

  return notifications;
}
