export interface OptimisticChatMessage {
  id: string;
  scopeKey: string;
  content: string;
  createdAt: number;
}

const EMPTY_MESSAGES: readonly OptimisticChatMessage[] = [];
const messagesByScope = new Map<string, readonly OptimisticChatMessage[]>();
const containersByScope = new Map<string, HTMLElement>();

function renderMessage(message: OptimisticChatMessage): HTMLElement {
  const row = document.createElement("div");
  row.dataset.optimisticChatId = message.id;
  row.className = "relative px-3 py-1.5";

  const metadata = document.createElement("div");
  metadata.className = "flex min-w-0 items-baseline gap-2";

  const sender = document.createElement("span");
  sender.className = "truncate text-sm font-medium text-neutral-200";
  sender.textContent = "You";

  const timestamp = document.createElement("span");
  timestamp.className = "text-[10px] text-neutral-500";
  timestamp.textContent = new Date(message.createdAt * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

  const delivery = document.createElement("span");
  delivery.className = "text-[10px] text-neutral-500";
  delivery.textContent = "Sending...";

  const content = document.createElement("p");
  content.className = "break-words text-sm text-neutral-300";
  content.textContent = message.content;

  metadata.append(sender, timestamp, delivery);
  row.append(metadata, content);
  return row;
}

function renderScope(scopeKey: string): void {
  const container = containersByScope.get(scopeKey);
  if (!container) return;
  container.replaceChildren(...getOptimisticChatMessages(scopeKey).map(renderMessage));
}

export function getOptimisticChatMessages(scopeKey: string): readonly OptimisticChatMessage[] {
  return messagesByScope.get(scopeKey) ?? EMPTY_MESSAGES;
}

export function registerOptimisticChatContainer(scopeKey: string, container: HTMLElement): () => void {
  containersByScope.set(scopeKey, container);
  renderScope(scopeKey);
  return () => {
    if (containersByScope.get(scopeKey) === container) containersByScope.delete(scopeKey);
  };
}

export function addOptimisticChatMessage(message: OptimisticChatMessage): void {
  const current = getOptimisticChatMessages(message.scopeKey);
  if (current.some((candidate) => candidate.id === message.id)) return;
  messagesByScope.set(message.scopeKey, [...current, message]);
  containersByScope.get(message.scopeKey)?.append(renderMessage(message));
}

export function removeOptimisticChatMessages(scopeKey: string, ids: ReadonlySet<string>): void {
  if (ids.size === 0) return;
  const current = getOptimisticChatMessages(scopeKey);
  const next = current.filter((message) => !ids.has(message.id));
  if (next.length === current.length) return;
  if (next.length > 0) messagesByScope.set(scopeKey, next);
  else messagesByScope.delete(scopeKey);
  renderScope(scopeKey);
}

export function clearOptimisticChatMessages(scopeKey: string): void {
  if (!messagesByScope.delete(scopeKey)) return;
  renderScope(scopeKey);
}
