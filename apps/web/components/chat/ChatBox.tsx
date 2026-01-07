import { useRef, useState, useEffect, useCallback } from "react";
import { Send, User, Shield, ShieldCheck, ShieldAlert, Archive, Trash2, Lock, LockOpen, X, MessageSquare, AtSign, Users, BookUser } from "lucide-react";
import { useIdentity } from "@/context/IdentityContext";
import { useTrustedPeers } from "@/context/TrustedPeersContext";
import { useKeyring } from "@/context/KeyringContext"; // Keyring Import
import { shortPubKey } from "@/lib/identity";
import { clearChannel, deleteMessage } from "@/lib/chatStorage";
import { pool, RELAYS, KIND_CHAT_MESSAGE, publishEvent, getTag } from "@/lib/nostr";
import { finalizeEvent, nip04 } from "nostr-tools";
import { encryptWhisper, decryptWhisper, isWhisperRecipient, KIND_WHISPER } from "@/lib/whisper";

interface ChatMessage {
    id: string;
    user_pubkey: string;
    text: string;
    timestamp: number;
    verified?: boolean;
    isEncrypted?: boolean;
    isWhisper?: boolean;
    whisperRecipients?: string[];
}

const hexBytes = (hex: string) => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    return bytes;
};

export function ChatBox({ channel, pubkey, broadcasterPubkey, adminPubkeys = [] }: {
    channel: string,
    pubkey?: string,
    broadcasterPubkey?: string,
    adminPubkeys?: string[]
}) {
    const { identity, sign, verify } = useIdentity();
    const { trustedKeys, isTrusted, banKey, unbanKey, isBanned } = useTrustedPeers();
    const { setAlias, getAlias, getRawAlias } = useKeyring(); // Keyring Hook
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [isConnected, setIsConnected] = useState(false);
    const [isEncrypted, setIsEncrypted] = useState(false);

    // Whisper state - now supports multiple targets
    const [whisperTargets, setWhisperTargets] = useState<string[]>([]); // Array of recipient pubkeys
    const [activeUsers, setActiveUsers] = useState<Map<string, string>>(new Map()); // pubkey -> short display name

    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Check if current user is broadcaster or admin
    const isBroadcasterOrAdmin = useCallback(() => {
        if (!identity?.nostrPublicKey) return false;
        if (identity.nostrPublicKey === broadcasterPubkey) return true;
        if (adminPubkeys.includes(identity.nostrPublicKey)) return true;
        return false;
    }, [identity?.nostrPublicKey, broadcasterPubkey, adminPubkeys]);

    // Initial Load & Subscribe
    useEffect(() => {
        if (!broadcasterPubkey || !channel) return;
        setIsConnected(true);

        const aTag = `30311:${broadcasterPubkey}:${channel}`;

        // Subscription 1: Public Chat & Whispers (Context-bound)
        const chatFilter = {
            kinds: [KIND_CHAT_MESSAGE, KIND_WHISPER],
            '#a': [aTag],
            limit: 100,
            since: 0
        };

        const sub = pool.subscribeMany(RELAYS, chatFilter as any, {
            onevent(event) {
                handleEvent(event);
            },
            oneose() { }
        });

        // Subscription 2: Direct Messages (Identity-bound)
        let dmSub: any = null;
        if (identity?.nostrPublicKey) {
            const dmFilter = {
                kinds: [4],
                '#p': [identity.nostrPublicKey],
                limit: 50,
                since: 0
            };
            dmSub = pool.subscribeMany(RELAYS, dmFilter as any, {
                onevent(event) {
                    handleEvent(event);
                },
                oneose() { }
            });
        }

        const handleEvent = (event: any) => {
            const processEvent = async () => {
                let text = event.content;
                let isEnc = false;
                let isWhisper = false;
                let whisperRecipients: string[] = [];

                // Track active users
                setActiveUsers(prev => {
                    const next = new Map(prev);
                    if (!next.has(event.pubkey)) {
                        next.set(event.pubkey, shortPubKey(event.pubkey));
                    }
                    return next;
                });

                // Handle Whispers (Kind 20004)
                if (event.kind === KIND_WHISPER && identity?.nostrPrivateKey && identity?.nostrPublicKey) {
                    isWhisper = true;
                    isEnc = true;

                    const canSee = isWhisperRecipient(event.content, identity.nostrPublicKey) ||
                        identity.nostrPublicKey === broadcasterPubkey ||
                        adminPubkeys.includes(identity.nostrPublicKey);

                    if (!canSee) return;

                    const decrypted = await decryptWhisper(
                        event.content,
                        identity.nostrPrivateKey,
                        identity.nostrPublicKey,
                        event.pubkey
                    );

                    if (decrypted) {
                        text = decrypted;
                    } else {
                        text = "[Whisper - Cannot decrypt]";
                    }

                    try {
                        const envelope = JSON.parse(event.content);
                        whisperRecipients = Object.keys(envelope.recipients || {});
                    } catch { }
                }
                // Handle DMs (Kind 4)
                else if (event.kind === 4 && identity?.nostrPrivateKey) {
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
                    isEncrypted: isEnc,
                    isWhisper: isWhisper,
                    whisperRecipients: whisperRecipients
                };

                setMessages(prev => {
                    if (prev.find(m => m.id === msg.id)) return prev;
                    return [...prev, msg].sort((a, b) => a.timestamp - b.timestamp).slice(-100);
                });
            };
            processEvent();
        };

        return () => {
            sub.close();
            if (dmSub) dmSub.close();
        };
    }, [channel, broadcasterPubkey, identity, adminPubkeys]);

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Click on username to add to whisper targets (or populate /name command if ctrl/cmd clicked? Nah, just normal click handling)
    // Actually, let's keep click for whisper target toggle for now. 
    // Maybe right click for alias? Or just use command.
    const toggleWhisperTarget = (targetPubkey: string) => {
        if (isBanned(targetPubkey)) return;
        setWhisperTargets(prev => {
            if (prev.includes(targetPubkey)) {
                return prev.filter(p => p !== targetPubkey);
            } else {
                return [...prev, targetPubkey];
            }
        });
        setIsEncrypted(false);
    };

    // Add clicked name to input for easy /name command
    const handleNameClick = (e: React.MouseEvent, targetPubkey: string) => {
        e.preventDefault(); // Prevent whisper toggle on right click or whatever
        if (e.ctrlKey || e.metaKey) {
            // Populate input with @pubkey
            setInput(prev => `${prev} @${targetPubkey} `);
            return;
        }
        toggleWhisperTarget(targetPubkey);
    };


    const cancelWhisper = () => {
        setWhisperTargets([]);
    };

    // Parse /name @<pubkey> <alias>
    const parseNameCommand = (text: string): { pubkey: string, alias: string } | null => {
        // Match: /name @pubkeyOrName Alias
        const match = text.match(/^\/name\s+@?(\S+)\s+(.+)$/i);
        if (!match) return null;

        const target = match[1];
        const alias = match[2];

        // Resolve target to pubkey
        let targetPubkey = target;

        // If target is not a full pubkey (64 hex chars), try to find it in active users
        if (target.length !== 64) {
            const found = Array.from(activeUsers.entries()).find(([pk]) => pk.toLowerCase().startsWith(target.toLowerCase()));
            if (found) targetPubkey = found[0];
            else return null; // Can't find user
        }

        return { pubkey: targetPubkey, alias };
    };

    // Parse /wh(name,name) command from input
    const parseWhisperCommand = (text: string): { targets: string[], message: string } | null => {
        // Match: /wh(name1,name2,name3) message here
        const match = text.match(/^\/wh\(([^)]+)\)\s+(.+)$/i);
        if (!match) return null;

        const nameList = match[1].split(',').map(n => n.trim().toLowerCase());
        const message = match[2];

        // Resolve names to pubkeys (match by prefix)
        const resolvedPubkeys: string[] = [];
        for (const name of nameList) {
            // Check if it's a pubkey prefix (8 chars) or display name (or Alias!)
            for (const [pubkey, displayName] of activeUsers.entries()) {
                const alias = getRawAlias(pubkey)?.toLowerCase();
                const prefix = pubkey.substring(0, 8).toLowerCase();

                if (prefix === name || displayName.toLowerCase().includes(name) || (alias && alias.includes(name))) {
                    if (!resolvedPubkeys.includes(pubkey)) {
                        resolvedPubkeys.push(pubkey);
                    }
                    break;
                }
            }
        }

        if (resolvedPubkeys.length === 0) return null;
        return { targets: resolvedPubkeys, message };
    };

    const sendMessage = async () => {
        if (!input.trim() || !identity?.nostrPrivateKey || !identity?.nostrPublicKey) {
            if (!identity?.nostrPrivateKey) alert("No Nostr identity found");
            return;
        }

        // 1. Check for /name command
        const nameCmd = parseNameCommand(input);
        if (nameCmd) {
            await setAlias(nameCmd.pubkey, nameCmd.alias);
            setInput("");
            // Optimistic / Local feedback? The hook updates state so UI should reflect immediately if using getAlias.
            // Maybe add a system message to chat? 
            const sysMsg: ChatMessage = {
                id: `sys-${Date.now()}`,
                user_pubkey: "system",
                text: `Aliased ${shortPubKey(nameCmd.pubkey)} to "${nameCmd.alias}"`,
                timestamp: Date.now(),
                verified: true
            };
            setMessages(prev => [...prev, sysMsg]);
            return;
        }

        // 2. Check for moderation commands (Broadcaster/Admin only)
        if (isBroadcasterOrAdmin()) {
            const modCommandMatch = input.match(/^\/(ban|mute|unban|unmute)\s+@?(.+)$/i);
            if (modCommandMatch) {
                const cmd = modCommandMatch[1].toLowerCase();
                const targetName = modCommandMatch[2].trim();
                let targetPubkey = targetName;

                // Resolve target
                if (targetName.length !== 64) {
                    // Try to find in active users
                    const found = Array.from(activeUsers.entries()).find(([pk, name]) =>
                        pk.toLowerCase().startsWith(targetName.toLowerCase()) ||
                        name.toLowerCase().includes(targetName.toLowerCase()) ||
                        getRawAlias(pk)?.toLowerCase().includes(targetName.toLowerCase())
                    );
                    if (found) targetPubkey = found[0];
                    else {
                        // Feedback: User not found
                        const err: ChatMessage = {
                            id: `sys-err-${Date.now()}`,
                            user_pubkey: "system",
                            text: `❌ User "${targetName}" not found.`,
                            timestamp: Date.now(),
                            verified: true
                        };
                        setMessages(prev => [...prev, err]);
                        return;
                    }
                }

                if (cmd === 'ban' || cmd === 'mute') {
                    await banKey(targetPubkey);
                    const sysMsg: ChatMessage = {
                        id: `sys-${Date.now()}`,
                        user_pubkey: "system",
                        text: `🚫 Banned @${getAlias(targetPubkey) || shortPubKey(targetPubkey)} (Muted on Nostr)`,
                        timestamp: Date.now(),
                        verified: true
                    };
                    setMessages(prev => [...prev, sysMsg]);
                } else if (cmd === 'unban' || cmd === 'unmute') {
                    // unbanKey isn't async in context but maybe should be? 
                    // It updates local state immediately.
                    unbanKey(targetPubkey);
                    const sysMsg: ChatMessage = {
                        id: `sys-${Date.now()}`,
                        user_pubkey: "system",
                        text: `✅ Unbanned @${getAlias(targetPubkey) || shortPubKey(targetPubkey)}`,
                        timestamp: Date.now(),
                        verified: true
                    };
                    setMessages(prev => [...prev, sysMsg]);
                }
                setInput("");
                return;
            }
        }

        let event: any;
        let isWhisperMsg = false;
        let actualMessage = input;
        let actualTargets = whisperTargets;

        // 3. Check for /wh command
        const parsed = parseWhisperCommand(input);
        if (parsed) {
            actualTargets = parsed.targets;
            actualMessage = parsed.message;
            isWhisperMsg = true;
        } else if (whisperTargets.length > 0 && broadcasterPubkey) {
            isWhisperMsg = true;
        }

        if (isWhisperMsg && broadcasterPubkey) {
            // WHISPER MODE - Multi-recipient encrypted
            const recipients = new Set([...actualTargets, broadcasterPubkey, ...adminPubkeys]);
            const recipientArray = Array.from(recipients);

            const encryptedEnvelope = await encryptWhisper(
                actualMessage,
                identity.nostrPrivateKey,
                identity.nostrPublicKey,
                recipientArray
            );

            event = {
                kind: KIND_WHISPER,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['a', `30311:${broadcasterPubkey}:${channel}`, 'root', 'reply'],
                    ...actualTargets.map(t => ['p', t]),
                ],
                content: encryptedEnvelope
            };
        } else if (isEncrypted && broadcasterPubkey) {
            const encrypted = await nip04.encrypt(identity.nostrPrivateKey, broadcasterPubkey, actualMessage);
            event = {
                kind: 4,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['p', broadcasterPubkey]],
                content: encrypted
            };
        } else {
            event = {
                kind: KIND_CHAT_MESSAGE,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['a', `30311:${broadcasterPubkey}:${channel}`, 'root', 'reply']],
                content: actualMessage,
            };
        }

        const signedEvent = finalizeEvent(event, hexBytes(identity.nostrPrivateKey));
        await publishEvent(signedEvent);

        // Optimistic update
        const msg: ChatMessage = {
            id: signedEvent.id,
            user_pubkey: identity.nostrPublicKey,
            text: actualMessage,
            timestamp: Date.now(),
            verified: true,
            isEncrypted: isEncrypted || isWhisperMsg,
            isWhisper: isWhisperMsg,
            whisperRecipients: isWhisperMsg ? [...actualTargets, broadcasterPubkey!, ...adminPubkeys] : undefined
        };
        setMessages(prev => [...prev, msg]);
        setInput("");

        if (whisperTargets.length > 0 || parsed) {
            cancelWhisper();
        }
    };

    const handleDelete = async (msgId: string) => {
        if (!confirm("Delete this message?")) return;
        await deleteMessage(msgId);
        setMessages(prev => prev.filter(m => m.id !== msgId));
    };

    const visibleMessages = messages.filter(m => !isBanned(m.user_pubkey));
    // Use Aliases in Whisper Indicator
    const whisperTargetNames = whisperTargets.map(p => getAlias(p)).join(', ');

    return (
        <div className="flex flex-col h-[600px] border border-neutral-800 rounded-lg bg-neutral-900/50 overflow-hidden">
            <div className="bg-neutral-900 p-3 border-b border-neutral-800 text-sm font-semibold flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <span>Live Chat</span>
                    {isBroadcasterOrAdmin() && (
                        <span className="text-xs text-yellow-500 bg-yellow-900/30 px-2 py-0.5 rounded">
                            👁 All Whispers
                        </span>
                    )}
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
                    <div key={`${msg.id}-${i}`} className={`flex flex-col gap-1 text-sm ${msg.isWhisper ? 'pl-2 border-l-2 border-purple-500 bg-purple-900/10' : msg.isEncrypted ? 'pl-2 border-l-2 border-purple-500' : ''} group relative pr-6`}>
                        {/* Admin Controls */}
                        {identity && identity.nostrPublicKey === broadcasterPubkey && (
                            <div className="absolute right-0 top-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {msg.user_pubkey !== identity.nostrPublicKey && (
                                    <button
                                        onClick={() => {
                                            if (confirm("Ban this user?")) banKey(msg.user_pubkey);
                                        }}
                                        className="p-1 bg-red-900/80 text-white text-xs rounded hover:bg-red-700"
                                        title="Ban User"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                )}
                                <button
                                    onClick={() => handleDelete(msg.id)}
                                    className="p-1 bg-neutral-700 text-white text-xs rounded hover:bg-neutral-600"
                                    title="Delete Message"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        )}

                        <div className="flex items-center gap-2 text-neutral-500 text-xs">
                            {msg.isWhisper ? (
                                <MessageSquare className="w-3 h-3 text-purple-400" />
                            ) : msg.isEncrypted ? (
                                <Lock className="w-3 h-3 text-purple-500" />
                            ) : msg.verified ? (
                                <ShieldCheck className="w-3 h-3 text-green-500" />
                            ) : (
                                <User className="w-3 h-3" />
                            )}
                            <button
                                onClick={(e) => handleNameClick(e, msg.user_pubkey)}
                                className={`hover:underline transition-colors ${whisperTargets.includes(msg.user_pubkey) ? 'text-purple-400 font-bold' : msg.verified ? 'text-green-400 hover:text-purple-400' : 'hover:text-purple-400'}`}
                                title={whisperTargets.includes(msg.user_pubkey) ? "Click to remove from whisper" : "Click to add to whisper (Cmd+Click to mention)"}
                            >
                                {/* USE ALIAS HERE */}
                                {msg.user_pubkey === "system" ? "dStream" : getAlias(msg.user_pubkey)}
                            </button>

                            {/* ALIAS ICON */}
                            {getRawAlias(msg.user_pubkey) && (
                                <span title={`Aliased: ${getRawAlias(msg.user_pubkey)}`}>
                                    <BookUser className="w-3 h-3 text-blue-400" />
                                </span>
                            )}

                            <span className="text-neutral-700">
                                {new Date(msg.timestamp).toLocaleTimeString()}
                            </span>
                            {msg.isWhisper && msg.whisperRecipients && (
                                <span className="text-purple-400 italic text-xs">
                                    → {msg.whisperRecipients.filter(r => r !== broadcasterPubkey && !adminPubkeys.includes(r)).map(r => getAlias(r)).join(', ') || 'you'}
                                </span>
                            )}
                        </div>
                        <p className={`break-words ${msg.isWhisper ? 'text-purple-200 italic' : msg.isEncrypted ? 'text-purple-200 italic' : 'text-neutral-200'}`}>
                            {msg.isWhisper && <span className="text-purple-400 font-semibold">whispers: </span>}
                            {msg.text}
                        </p>
                    </div>
                ))}
                {messages.length === 0 && (
                    <div className="text-center text-neutral-600 mt-20">No messages yet. Say hi!</div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-3 bg-neutral-900 border-t border-neutral-800 flex flex-col gap-2">
                {/* Whisper Targets Indicator */}
                {whisperTargets.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-purple-400 bg-purple-900/20 px-3 py-1 rounded">
                        {whisperTargets.length > 1 ? <Users className="w-4 h-4" /> : <AtSign className="w-4 h-4" />}
                        <span>Whispering to <strong>{whisperTargetNames}</strong></span>
                        <button onClick={cancelWhisper} className="ml-auto text-purple-300 hover:text-white">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                )}

                <div className="flex gap-2">
                    <button
                        onClick={() => broadcasterPubkey && setIsEncrypted(!isEncrypted)}
                        disabled={!broadcasterPubkey || whisperTargets.length > 0}
                        className={`p-2 rounded transition-colors ${isEncrypted ? 'text-purple-400 bg-purple-900/20' : 'text-neutral-500 hover:text-white'} ${whisperTargets.length > 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title={whisperTargets.length > 0 ? "Whisper mode active" : isEncrypted ? "Encrypted DM Mode" : "Public Chat Mode"}
                    >
                        {isEncrypted ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
                    </button>
                    <input
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && sendMessage()}
                        placeholder={
                            whisperTargets.length > 0
                                ? `Whisper to ${whisperTargets.length} user${whisperTargets.length > 1 ? 's' : ''}...`
                                : "/name @user alias | /wh(user) msg"
                        }
                        className={`flex-1 bg-neutral-950 border rounded px-3 py-2 text-sm text-white focus:outline-none ${whisperTargets.length > 0 ? 'border-purple-600 focus:border-purple-400' : isEncrypted ? 'border-purple-800 focus:border-purple-600' : 'border-neutral-800 focus:border-blue-600'}`}
                    />
                    <button
                        onClick={sendMessage}
                        disabled={!isConnected}
                        className={`${whisperTargets.length > 0 || isEncrypted ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'} text-white p-2 rounded disabled:opacity-50 transition-colors`}
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </div>

                {/* Help text */}
                <div className="text-xs text-neutral-600">
                    <code className="bg-neutral-800 px-1 rounded">/name @user Alias</code> to rename. Cmd+Click user to mention.
                </div>
            </div>
        </div>
    );
}
