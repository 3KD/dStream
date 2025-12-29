import { useRef, useState, useEffect } from "react";
import { Send, User, Shield, ShieldCheck, ShieldAlert, Archive, Trash2, Lock, LockOpen } from "lucide-react";
import { useIdentity } from "@/context/IdentityContext";
import { useTrustedPeers } from "@/context/TrustedPeersContext";
import { shortPubKey } from "@/lib/identity";
import { clearChannel } from "@/lib/chatStorage";
import { pool, RELAYS, KIND_CHAT_MESSAGE, publishEvent, getTag } from "@/lib/nostr";
import { finalizeEvent, nip04 } from "nostr-tools";
import { hexToBytes } from "viem";

interface ChatMessage {
    id: string;
    user_pubkey: string;
    text: string;
    timestamp: number;
    verified?: boolean;
    isEncrypted?: boolean;
}

const hexBytes = (hex: string) => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    return bytes;
};

export function ChatBox({ channel, pubkey, broadcasterPubkey }: { channel: string, pubkey?: string, broadcasterPubkey?: string }) {
    const { identity, sign, verify } = useIdentity();
    const { trustedKeys, isTrusted, banKey, isBanned } = useTrustedPeers();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [isConnected, setIsConnected] = useState(false);
    const [isEncrypted, setIsEncrypted] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Initial Load & Subscribe
    useEffect(() => {
        if (!broadcasterPubkey) return;
        setIsConnected(true);

        const aTag = `30311:${broadcasterPubkey}:${channel}`;

        // Subscribe to:
        // 1. Group Chat (Kind 1) linked to stream
        // 2. Direct Messages (Kind 4) if we are the broadcaster OR if we are a viewer sending/receiving DMs
        // simplified: Just listen for Kind 1 for now.
        // To properly support Kind 4 mixed in requires complex filtering (authors=Broadcaster, p=Me OR authors=Me, p=Broadcaster)
        // For MVP "Private Chat", we will LISTEN to Kind 4 targeting US.

        const filters: any[] = [{
            kinds: [KIND_CHAT_MESSAGE],
            '#a': [aTag]
        }];

        if (identity?.nostrPublicKey) {
            filters.push({
                kinds: [4],
                '#p': [identity.nostrPublicKey] // DMs to me
            });
            // Note: We might miss DMs *I* sent to broadcaster unless I query authors=[me]. 
            // For simple chat box, showing received DMs is key.
        }

        const sub = pool.subscribeMany(RELAYS, filters as any, {
            onevent(event) {
                // If Kind 4, decrypt
                const processEvent = async () => {
                    let text = event.content;
                    let isEnc = false;

                    if (event.kind === 4 && identity?.nostrPrivateKey) {
                        try {
                            text = await nip04.decrypt(identity.nostrPrivateKey, event.pubkey, event.content);
                            isEnc = true;
                        } catch (e) {
                            text = "[Encrypted Message - Could not decrypt]";
                            isEnc = true;
                        }
                    } else if (event.kind === 4) {
                        text = "[Encrypted Message]";
                        isEnc = true;
                    }

                    const msg: ChatMessage = {
                        id: event.id,
                        user_pubkey: event.pubkey,
                        text: text,
                        timestamp: event.created_at * 1000,
                        verified: true,
                        isEncrypted: isEnc
                    };

                    setMessages(prev => {
                        if (prev.find(m => m.id === msg.id)) return prev;
                        return [...prev, msg].sort((a, b) => a.timestamp - b.timestamp).slice(-100);
                    });
                };
                processEvent();
            },
            oneose() {
            }
        });

        return () => sub.close();
    }, [channel, broadcasterPubkey, identity]); // Re-sub if identity changes (login)

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const sendMessage = async () => {
        if (!input.trim() || !identity?.nostrPrivateKey) {
            if (!identity?.nostrPrivateKey) alert("No Nostr identity found");
            return;
        }

        let event: any;

        if (isEncrypted && broadcasterPubkey) {
            // Kind 4 DM to Broadcaster
            const encrypted = await nip04.encrypt(identity.nostrPrivateKey, broadcasterPubkey, input);
            event = {
                kind: 4, // NIP-04 Encrypted Direct Message
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['p', broadcasterPubkey],
                ],
                content: encrypted
            };
        } else {
            // Group Chat
            event = {
                kind: KIND_CHAT_MESSAGE,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['a', `30311:${broadcasterPubkey}:${channel}`, 'root', 'reply']
                ],
                content: input,
            };
        }

        const signedEvent = finalizeEvent(event, hexBytes(identity.nostrPrivateKey));
        await publishEvent(signedEvent);

        // Optimistic update
        const msg: ChatMessage = {
            id: signedEvent.id,
            user_pubkey: identity.nostrPublicKey || identity.publicKey,
            text: input,
            timestamp: Date.now(),
            verified: true,
            isEncrypted: isEncrypted
        };
        setMessages(prev => [...prev, msg]);
        setInput("");
    };

    // Filter messages from banned users
    const visibleMessages = messages.filter(m => !isBanned(m.user_pubkey));

    return (
        <div className="flex flex-col h-[600px] border border-neutral-800 rounded-lg bg-neutral-900/50 overflow-hidden">
            <div className="bg-neutral-900 p-3 border-b border-neutral-800 text-sm font-semibold flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <span>Live Chat</span>
                </div>
                <div className="flex items-center gap-2">
                    {identity && (
                        <span className="text-xs text-neutral-500 flex items-center gap-1">
                            <Shield className="w-3 h-3 text-green-500" />
                            Signed
                        </span>
                    )}
                    <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {visibleMessages.map((msg, i) => (
                    <div key={`${msg.timestamp}-${i}`} className={`flex flex-col gap-1 text-sm ${msg.isEncrypted ? 'pl-2 border-l-2 border-purple-500' : ''} group relative`}>
                        {/* Ban Button (Only if I am Broadcaster and msg is not from me) */}
                        {identity && identity.nostrPublicKey === broadcasterPubkey && msg.user_pubkey !== identity.nostrPublicKey && (
                            <button
                                onClick={() => {
                                    if (confirm("Ban this user? They will be muted and reported.")) banKey(msg.user_pubkey);
                                }}
                                className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 p-1 bg-red-900/80 text-white text-xs rounded hover:bg-red-700 transition-opacity"
                                title="Ban User (Slash)"
                            >
                                <Trash2 className="w-3 h-3" />
                            </button>
                        )}

                        <div className="flex items-center gap-2 text-neutral-500 text-xs">
                            {msg.isEncrypted ? (
                                <Lock className="w-3 h-3 text-purple-500" />
                            ) : msg.verified ? (
                                <ShieldCheck className="w-3 h-3 text-green-500" />
                            ) : (
                                <User className="w-3 h-3" />
                            )}
                            <span className={msg.verified ? 'text-green-400' : ''}>
                                {shortPubKey(msg.user_pubkey)}
                            </span>
                            <span className="text-neutral-700">
                                {new Date(msg.timestamp).toLocaleTimeString()}
                            </span>
                        </div>
                        <p className={`text-neutral-200 break-words ${msg.isEncrypted ? 'text-purple-200 italic' : ''}`}>
                            {msg.text}
                        </p>
                    </div>
                ))}
                {messages.length === 0 && (
                    <div className="text-center text-neutral-600 mt-20">No messages yet. Say hi!</div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-3 bg-neutral-900 border-t border-neutral-800 flex gap-2">
                <button
                    onClick={() => broadcasterPubkey && setIsEncrypted(!isEncrypted)}
                    disabled={!broadcasterPubkey}
                    className={`p-2 rounded transition-colors ${isEncrypted ? 'text-purple-400 bg-purple-900/20' : 'text-neutral-500 hover:text-white'}`}
                    title={isEncrypted ? "Encrypted DM Mode (Only Host sees this)" : "Public Chat Mode"}
                >
                    {isEncrypted ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
                </button>
                <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendMessage()}
                    placeholder={isEncrypted ? "Send private DM to host..." : (identity ? "Send a signed message..." : "Send a message...")}
                    className={`flex-1 bg-neutral-950 border rounded px-3 py-2 text-sm text-white focus:outline-none ${isEncrypted ? 'border-purple-800 focus:border-purple-600' : 'border-neutral-800 focus:border-blue-600'}`}
                />
                <button
                    onClick={sendMessage}
                    disabled={!isConnected}
                    className={`${isEncrypted ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'} text-white p-2 rounded disabled:opacity-50 transition-colors`}
                >
                    <Send className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
