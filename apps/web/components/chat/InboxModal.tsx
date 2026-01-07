"use client";

import { useState, useEffect, useRef } from "react";
import { X, Mail, MessageSquare, Loader2, Send, Lock, Reply } from "lucide-react";
import { useIdentity } from "@/context/IdentityContext";
import { useKeyring } from "@/context/KeyringContext";
import { useInbox } from "@/context/InboxContext";
import { publishEvent } from "@/lib/nostr";
import { nip04, finalizeEvent } from "nostr-tools";
import { shortPubKey } from "@/lib/identity";

interface DM {
    id: string;
    pubkey: string;
    content: string;
    created_at: number;
    decrypted?: string;
    isSelf?: boolean;
}

export function InboxModal() {
    const { identity } = useIdentity();
    const { getAlias } = useKeyring();
    const { threads, isOpen, closeInbox, markThreadAsRead, loading, onlyTrusted, setOnlyTrusted } = useInbox();

    const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
    const [replyText, setReplyText] = useState("");
    const [sending, setSending] = useState(false);
    const [showNewChat, setShowNewChat] = useState(false);
    const [newChatPubkey, setNewChatPubkey] = useState("");

    const startNewChat = () => {
        if (!newChatPubkey.trim()) return;
        setSelectedPeer(newChatPubkey.trim());
        setShowNewChat(false);
        setNewChatPubkey("");
    };

    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Scroll to bottom of active thread
    useEffect(() => {
        if (selectedPeer && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [selectedPeer, threads]);

    // Mark as read when selecting a peer
    useEffect(() => {
        if (selectedPeer) {
            markThreadAsRead(selectedPeer);
        }
    }, [selectedPeer]); // Dependency on selectedPeer, logic handles redundant calls usually (or innocuous)

    // Close on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isOpen) {
                closeInbox();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, closeInbox]);

    if (!isOpen) return null;

    const sendReply = async () => {
        if (!replyText.trim() || !selectedPeer || !identity?.nostrPrivateKey) return;
        setSending(true);

        try {
            const encrypted = await nip04.encrypt(identity.nostrPrivateKey, selectedPeer, replyText);

            // Helpful hex converter
            const hexToBytes = (hex: string) => {
                const bytes = new Uint8Array(hex.length / 2);
                for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
                return bytes;
            };

            const event = {
                kind: 4,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['p', selectedPeer]],
                content: encrypted
            };

            const signed = finalizeEvent(event, hexToBytes(identity.nostrPrivateKey));
            await publishEvent(signed);
            setReplyText("");
        } catch (e) {
            alert("Failed to send: " + e);
        } finally {
            setSending(false);
        }
    };

    const activeThread = threads.find(t => t.peerPubkey === selectedPeer);


    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-5xl h-[700px] flex shadow-2xl relative overflow-hidden ring-1 ring-white/10" onClick={e => e.stopPropagation()}>

                {/* Close Button */}
                <button
                    onClick={closeInbox}
                    className="absolute top-4 right-4 z-10 p-2 bg-neutral-800 hover:bg-neutral-700 rounded-full text-neutral-400 hover:text-white transition-colors border border-black/20"
                >
                    <X className="w-5 h-5" />
                </button>

                {/* Sidebar (Thread List) */}
                <div className={`w-full md:w-[350px] border-r border-neutral-800 flex flex-col bg-neutral-900 ${selectedPeer ? 'hidden md:flex' : 'flex'}`}>
                    <div className="p-4 border-b border-neutral-800 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                <Mail className="w-5 h-5 text-blue-500" />
                                Inbox
                            </h2>
                            <button
                                onClick={() => setShowNewChat(true)}
                                className="p-2 hover:bg-neutral-800 rounded-full text-blue-400 transition-colors"
                                title="New Message"
                            >
                                <MessageSquare className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Trusted Only Toggle */}
                        <button
                            onClick={() => setOnlyTrusted(!onlyTrusted)}
                            className={`flex items-center justify-center gap-2 w-full py-2 rounded-lg text-xs font-bold transition-all border ${onlyTrusted
                                ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                                : 'bg-neutral-950 text-neutral-500 border-neutral-800 hover:bg-neutral-800'
                                }`}
                        >
                            <div className={`w-2 h-2 rounded-full ${onlyTrusted ? 'bg-blue-500' : 'bg-neutral-600'}`} />
                            {onlyTrusted ? "Showing Trusted Only" : "Showing All Messages"}
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {loading && threads.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-20 text-neutral-500">
                                <Loader2 className="w-8 h-8 animate-spin mb-3 text-neutral-700" />
                                <p className="text-sm">Syncing DMs...</p>
                            </div>
                        )}

                        {!loading && threads.length === 0 && (
                            <div className="p-8 text-center text-neutral-500 flex flex-col items-center">
                                <Mail className="w-12 h-12 text-neutral-800 mb-4" />
                                <p className="font-medium text-neutral-400">No messages yet</p>
                                <p className="text-xs mt-2 max-w-[200px]">Messages from people you follow will appear here.</p>
                            </div>
                        )}

                        {threads.map(thread => (
                            <button
                                key={thread.peerPubkey}
                                onClick={() => setSelectedPeer(thread.peerPubkey)}
                                className={`w-full text-left p-4 hover:bg-neutral-800/50 transition-all border-b border-neutral-800/50 group ${selectedPeer === thread.peerPubkey
                                    ? 'bg-blue-900/10 border-l-4 border-l-blue-500'
                                    : 'border-l-4 border-l-transparent'
                                    }`}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <span className={`font-bold truncate pr-2 flex items-center gap-2 text-sm ${thread.hasUnread ? 'text-white' : 'text-neutral-400 group-hover:text-neutral-300'}`}>
                                        {thread.hasUnread && <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />}
                                        {getAlias(thread.peerPubkey)}
                                    </span>
                                    <span className="text-[10px] text-neutral-600 whitespace-nowrap">
                                        {new Date(thread.lastMessageAt * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    </span>
                                </div>
                                <div className={`text-xs truncate h-5 ${thread.hasUnread ? 'text-neutral-300 font-medium' : 'text-neutral-500'}`}>
                                    {thread.messages[thread.messages.length - 1].isSelf && <span className="text-blue-500 mr-1">You:</span>}
                                    {thread.messages[thread.messages.length - 1].decrypted || "..."}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Main Content (Chat View) */}
                <div className={`w-full flex flex-col bg-neutral-950 relative ${!selectedPeer ? 'hidden md:flex' : 'flex'}`}>

                    {showNewChat && (
                        <div className="absolute inset-0 z-50 bg-neutral-900/95 flex flex-col items-center justify-center p-8 backdrop-blur animate-in fade-in">
                            <div className="w-full max-w-md space-y-4">
                                <h3 className="text-xl font-bold flex items-center gap-2">
                                    <MessageSquare className="w-5 h-5 text-blue-500" />
                                    Start New Conversation
                                </h3>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="Paste Public Key (hex or npub)..."
                                        className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:ring-1 focus:ring-blue-500 outline-none"
                                        value={newChatPubkey}
                                        onChange={e => setNewChatPubkey(e.target.value)}
                                        autoFocus
                                    />
                                    <button
                                        onClick={startNewChat}
                                        className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-6 rounded-xl transition-colors"
                                    >
                                        Go
                                    </button>
                                </div>
                                <button onClick={() => setShowNewChat(false)} className="text-sm text-neutral-500 hover:text-white underline">
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}

                    {selectedPeer ? (
                        <>
                            {/* Chat Header */}
                            <div className="h-16 px-6 border-b border-neutral-800 flex items-center gap-4 bg-neutral-900/50 backdrop-blur-sm z-10">
                                <button
                                    onClick={() => setSelectedPeer(null)}
                                    className="md:hidden p-2 -ml-2 text-neutral-400 hover:text-white"
                                >
                                    <Reply className="w-5 h-5" />
                                </button>

                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-900 to-purple-900 flex items-center justify-center text-white font-bold text-sm ring-2 ring-black">
                                    {getAlias(selectedPeer)[0].toUpperCase()}
                                </div>

                                <div className="flex flex-col">
                                    <span className="font-bold text-white leading-tight">{getAlias(selectedPeer)}</span>
                                    <span className="text-[10px] text-neutral-500 font-mono flex items-center gap-1">
                                        {shortPubKey(selectedPeer)}
                                        <Lock className="w-3 h-3 opacity-50" />
                                    </span>
                                </div>
                            </div>

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                                {activeThread?.messages.map((msg: DM, i, arr) => {
                                    const isSequence = i > 0 && arr[i - 1].isSelf === msg.isSelf;
                                    return (
                                        <div
                                            key={msg.id}
                                            className={`flex flex-col max-w-[75%] ${msg.isSelf ? 'ml-auto items-end' : 'items-start'}`}
                                        >
                                            <div
                                                className={`px-4 py-3 text-sm break-words shadow-sm ${msg.isSelf
                                                    ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm'
                                                    : 'bg-neutral-800 text-neutral-200 rounded-2xl rounded-tl-sm'
                                                    } ${isSequence ? 'mt-1' : 'mt-0'}`}
                                            >
                                                {msg.decrypted || <span className="italic opacity-50 flex items-center gap-1"><Lock className="w-3 h-3" /> Encrypted Message</span>}
                                            </div>
                                            {!isSequence && (
                                                <span className={`text-[10px] text-neutral-600 mt-1 px-1 ${msg.isSelf ? 'text-right' : 'text-left'}`}>
                                                    {new Date(msg.created_at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Reply Input */}
                            <div className="p-4 bg-neutral-900 border-t border-neutral-800">
                                <div className="flex gap-2 items-end bg-neutral-950 p-2 rounded-xl border border-neutral-800 focus-within:border-blue-500/50 transition-colors">
                                    <textarea
                                        value={replyText}
                                        onChange={e => setReplyText(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                sendReply();
                                            }
                                        }}
                                        placeholder={`Message ${getAlias(selectedPeer)}...`}
                                        disabled={sending}
                                        rows={1}
                                        className="flex-1 bg-transparent border-none text-white focus:ring-0 resize-none max-h-32 py-2 px-2 custom-scrollbar placeholder:text-neutral-600"
                                        style={{ minHeight: '44px' }}
                                    />
                                    <button
                                        onClick={sendReply}
                                        disabled={!replyText.trim() || sending}
                                        className="p-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95 mb-[1px]"
                                    >
                                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                    </button>
                                </div>
                                <div className="text-[10px] text-neutral-600 text-center mt-2 flex items-center justify-center gap-1">
                                    <Lock className="w-3 h-3" /> End-to-end encrypted via Nostr (NIP-04)
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-neutral-600">
                            <div className="w-24 h-24 bg-neutral-900 rounded-full flex items-center justify-center mb-6">
                                <MessageSquare className="w-10 h-10 opacity-50" />
                            </div>
                            <h3 className="text-xl font-bold text-neutral-400 mb-2">No Chat Selected</h3>
                            <p className="text-sm max-w-xs text-center mb-8">Select a conversation from the sidebar or start a new encrypted chat.</p>

                            <button
                                onClick={() => setShowNewChat(true)}
                                className="bg-neutral-800 hover:bg-neutral-700 text-white px-6 py-3 rounded-full font-bold transition-all border border-neutral-700"
                            >
                                Start New Chat
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

