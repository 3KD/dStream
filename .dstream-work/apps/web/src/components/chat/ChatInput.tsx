"use client";

import { useEffect, useState, useRef, useMemo, type FormEvent } from "react";
import { Smile, X } from "lucide-react";
import dynamic from "next/dynamic";

const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });

export function ChatInput({
  onSend,
  disabled,
  placeholder,
  draftMessage,
  draftVersion,
  emotesDict
}: {
  onSend: (message: string) => Promise<boolean>;
  disabled?: boolean;
  placeholder?: string;
  draftMessage?: string;
  draftVersion?: number;
  emotesDict?: Record<string, { url: string }>;
}) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [message]);

  const customEmojis = useMemo(() => {
    if (!emotesDict) return undefined;
    const items = Object.entries(emotesDict).map(([shortcode, data]) => ({
      id: shortcode,
      names: [shortcode],
      imgUrl: data.url
    }));
    return items.length > 0 ? items : undefined;
  }, [emotesDict]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setShowEmoji(false);
      }
    }
    if (showEmoji) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showEmoji]);

  useEffect(() => {
    const handleGlobalEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape" && showEmoji) {
        setShowEmoji(false);
      }
    };
    if (showEmoji) {
      window.addEventListener("keydown", handleGlobalEsc);
    }
    return () => {
      window.removeEventListener("keydown", handleGlobalEsc);
    };
  }, [showEmoji]);

  useEffect(() => {
    if (draftVersion === undefined) return;
    setMessage(draftMessage ?? "");
  }, [draftMessage, draftVersion]);

  const submitMessage = async () => {
    const text = message.trim();
    if (!text || disabled || isSending) return;
    setIsSending(true);
    try {
      const ok = await onSend(text);
      if (ok) {
        setMessage("");
        setShowEmoji(false);
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    submitMessage();
  };

  const onEmojiClick = (emojiObj: any) => {
    if (emojiObj.isCustom && emojiObj.names?.[0]) {
      setMessage((prev) => prev + `:${emojiObj.names[0]}: `);
    } else if (emojiObj.emoji) {
      setMessage((prev) => prev + emojiObj.emoji);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="shrink-0 pt-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-neutral-700 bg-neutral-900 relative">
      {showEmoji && (
        <div ref={pickerRef} className="absolute bottom-[calc(100%+0.5rem)] right-3 z-50 shadow-2xl bg-neutral-900 border border-neutral-700 rounded-xl overflow-hidden flex flex-col pointer-events-auto">
          <div className="flex justify-between items-center px-3 py-2 bg-neutral-800 border-b border-neutral-700 shrink-0">
            <span className="text-xs font-semibold text-neutral-300">Emotes</span>
            <button 
              type="button" 
              onClick={() => setShowEmoji(false)} 
              className="text-neutral-400 hover:text-white hover:bg-neutral-700 p-0.5 rounded transition-colors"
              title="Close Emotes (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <EmojiPicker 
            onEmojiClick={onEmojiClick} 
            theme={"dark" as any} 
            autoFocusSearch={false}
            customEmojis={customEmojis}
          />
        </div>
      )}
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitMessage();
            }
          }}
          placeholder={placeholder ?? "Send a message…"}
          disabled={disabled || isSending}
          rows={1}
          style={{ height: "38px" }}
          className="flex-1 bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none disabled:opacity-50 resize-none min-h-[38px] max-h-[150px] overflow-y-auto w-full leading-tight"
        />
        <button
          type="button"
          disabled={disabled || isSending}
          onClick={() => setShowEmoji((prev) => !prev)}
          className="px-3 bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 rounded-lg text-neutral-400 hover:text-white transition-colors disabled:opacity-50 flex items-center justify-center p-0.5"
          title="Add Emoji"
        >
          <Smile className="w-5 h-5 pointer-events-none" />
        </button>
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
