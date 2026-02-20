"use client";
import { useState, FormEvent } from 'react';
import { useIdentity } from '@/context/IdentityContext';

interface ChatInputProps {
    onSend: (message: string) => Promise<boolean>;
    disabled?: boolean;
    placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder = "Send a message..." }: ChatInputProps) {
    const { identity } = useIdentity();
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!message.trim() || !identity || isSending) return;

        setIsSending(true);
        const success = await onSend(message.trim());
        if (success) {
            setMessage('');
        }
        setIsSending(false);
    };

    if (!identity) {
        return (
            <div className="p-3 border-t border-neutral-700 bg-neutral-900 text-center">
                <span className="text-sm text-neutral-500">Sign in to chat</span>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="p-3 border-t border-neutral-700 bg-neutral-900">
            <div className="flex gap-2">
                <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={placeholder}
                    disabled={disabled || isSending}
                    className="flex-1 bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />
                <button
                    type="submit"
                    disabled={!message.trim() || disabled || isSending}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-sm font-medium"
                >
                    {isSending ? '...' : 'Send'}
                </button>
            </div>
        </form>
    );
}
