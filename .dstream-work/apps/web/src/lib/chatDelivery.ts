export type ChatDeliveryStatus = "sending" | "sent" | "failed";

export function startChatDelivery(
  publish: () => Promise<boolean>,
  onSettled: (status: Exclude<ChatDeliveryStatus, "sending">) => void
): void {
  let result: Promise<boolean>;
  try {
    result = publish();
  } catch {
    onSettled("failed");
    return;
  }

  void result.then(
    (ok) => onSettled(ok ? "sent" : "failed"),
    () => onSettled("failed")
  );
}

export function updateChatDeliveryStatus<T extends { id?: string; deliveryStatus?: ChatDeliveryStatus }>(
  messages: T[],
  messageId: string,
  deliveryStatus: ChatDeliveryStatus
): T[] {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0 || messages[index]?.deliveryStatus === deliveryStatus) return messages;

  const next = messages.slice();
  next[index] = { ...next[index], deliveryStatus };
  return next;
}
