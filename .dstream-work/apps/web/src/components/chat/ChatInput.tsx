"use client";

import { useEffect, useState, type FormEvent } from "react";

export function ChatInput({
  onSend,
  disabled,
  placeholder,
  draftMessage,
  draftVersion
}: {
  onSend: (message: string) => Promise<boolean>;
  disabled?: boolean;
  placeholder?: string;
  draftMessage?: string;
  draftVersion?: number;
}) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (draftVersion === undefined) return;
    setMessage(draftMessage ?? "");
  }, [draftMessage, draftVersion]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    if (!text || disabled || isSending) return;
    setIsSending(true);
    try {
      const ok = await onSend(text);
      if (ok) setMessage("");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="shrink-0 pt-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-neutral-700 bg-neutral-900">
      <div className="flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={placeholder ?? "Send a message…"}
          disabled={disabled || isSending}
          className="flex-1 bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!message.trim() || disabled || isSending}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-sm font-medium"
        >
          {isSending ? "…" : "Send"}
        </button>
      </div>
    </form>
  );
}
