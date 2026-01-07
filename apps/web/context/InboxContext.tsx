"use client";

import { createContext, useContext, useState, useEffect, ReactNode, useRef } from "react";
import { useIdentity } from "@/context/IdentityContext";
import { useTrustedPeers } from "@/context/TrustedPeersContext";
import { pool, RELAYS, publishEvent } from "@/lib/nostr";
import { nip04, finalizeEvent } from "nostr-tools";

interface DM {
    id: string;
    pubkey: string;
    content: string;
    created_at: number;
    decrypted?: string;
    isSelf?: boolean;
}

interface Thread {
    peerPubkey: string;
    lastMessageAt: number;
    messages: DM[];
    hasUnread: boolean;
}

interface InboxContextType {
    threads: Thread[];
    unreadCount: number;
    isOpen: boolean;
    openInbox: () => void;
    closeInbox: () => void;
    toggleInbox: () => void;
    markThreadAsRead: (peerPubkey: string) => void;
    loading: boolean;
    onlyTrusted: boolean;
    setOnlyTrusted: (val: boolean) => void;
}

const InboxContext = createContext<InboxContextType | undefined>(undefined);

export function InboxProvider({ children }: { children: ReactNode }) {
    const { identity } = useIdentity();
    const { isTrusted, isBanned } = useTrustedPeers();
    const [threads, setThreads] = useState<Thread[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [onlyTrusted, setOnlyTrusted] = useState(false);

    // Last read timestamps map: peerPubkey -> timestamp
    const [lastReadMap, setLastReadMap] = useState<Record<string, number>>({});

    // Load state from local storage
    useEffect(() => {
        if (!identity?.publicKey) return;

        // Load Read State
        const readKey = `dstream_inbox_read_${identity.publicKey}`;
        const trustedKey = `dstream_inbox_trusted_only_${identity.publicKey}`;

        try {
            const storedRead = localStorage.getItem(readKey);
            if (storedRead) setLastReadMap(JSON.parse(storedRead));

            const storedTrusted = localStorage.getItem(trustedKey);
            if (storedTrusted) setOnlyTrusted(JSON.parse(storedTrusted));
        } catch (e) {
            console.warn("Failed to load inbox state", e);
        }
    }, [identity?.publicKey]);

    // Save OnlyTrusted preference
    const updateOnlyTrusted = (val: boolean) => {
        setOnlyTrusted(val);
        if (identity?.publicKey) {
            localStorage.setItem(`dstream_inbox_trusted_only_${identity.publicKey}`, JSON.stringify(val));
        }
    };

    // Save last read map
    const saveLastRead = (newMap: Record<string, number>) => {
        setLastReadMap(newMap);
        if (identity?.publicKey) {
            localStorage.setItem(`dstream_inbox_read_${identity.publicKey}`, JSON.stringify(newMap));
        }
    };

    // Helper to decrypt
    const decryptMessage = async (myPrivKey: string, peerPubkey: string, content: string) => {
        try {
            return await nip04.decrypt(myPrivKey, peerPubkey, content);
        } catch (e) {
            return "[Encrypted]";
        }
    };

    // Subscribe to messages
    useEffect(() => {
        if (!identity?.nostrPublicKey || !identity?.nostrPrivateKey) {
            setLoading(false);
            return;
        }

        setLoading(true);
        const sub = pool.subscribeMany(RELAYS, [
            { kinds: [4], '#p': [identity.nostrPublicKey] }, // Received
            { kinds: [4], authors: [identity.nostrPublicKey] } // Sent
        ] as any, {
            onevent(event) {
                handleEvent(event);
            },
            oneose() {
                setLoading(false);
            }
        });

        const handleEvent = async (event: any) => {
            let peer = event.pubkey;
            let isSelf = event.pubkey === identity.nostrPublicKey;

            if (isSelf) {
                const pTag = event.tags.find((t: string[]) => t[0] === 'p');
                if (pTag) peer = pTag[1];
            }

            if (!peer) return;

            let decrypted = "[Encrypted]";
            if (identity.nostrPrivateKey) {
                decrypted = await decryptMessage(identity.nostrPrivateKey, peer, event.content);
            }

            const msg: DM = {
                id: event.id,
                pubkey: event.pubkey,
                content: event.content,
                created_at: event.created_at,
                decrypted,
                isSelf
            };

            setThreads(prev => {
                const existing = prev.find(t => t.peerPubkey === peer);

                // If message already exists, ignore
                if (existing?.messages.some(m => m.id === msg.id)) return prev;

                let updatedMessages = existing ? [...existing.messages, msg] : [msg];
                updatedMessages.sort((a, b) => a.created_at - b.created_at);

                const lastMessageAt = Math.max(existing?.lastMessageAt || 0, msg.created_at);

                const newThread: Thread = {
                    peerPubkey: peer,
                    lastMessageAt,
                    messages: updatedMessages,
                    hasUnread: false // Calculated in derived state or render? Better to store here relative to `lastReadMap`
                };

                // We need to update this thread in the list
                let newList;
                if (existing) {
                    newList = prev.map(t => t.peerPubkey === peer ? newThread : t);
                } else {
                    newList = [...prev, newThread];
                }

                return newList.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
            });
        };

        return () => sub.close();
    }, [identity?.nostrPublicKey, identity?.nostrPrivateKey]);

    // Calculate unread count and status based on `lastReadMap`
    // AND Filter based on Privacy Settings
    const threadsWithStatus = threads
        .filter(t => {
            // 1. Always block banned
            if (isBanned(t.peerPubkey)) return false;
            // 2. Filter untrusted only if enabled
            if (onlyTrusted && !isTrusted(t.peerPubkey)) return false;
            return true;
        })
        .map(t => {
            const lastRead = lastReadMap[t.peerPubkey] || 0;
            const lastMsg = t.messages[t.messages.length - 1];
            const isUnread = lastMsg.created_at > lastRead && !lastMsg.isSelf;
            return { ...t, hasUnread: isUnread };
        });

    const unreadCount = threadsWithStatus.filter(t => t.hasUnread).length;

    const openInbox = () => setIsOpen(true);
    const closeInbox = () => setIsOpen(false);
    const toggleInbox = () => setIsOpen(prev => !prev);

    const markThreadAsRead = (peerPubkey: string) => {
        const now = Math.floor(Date.now() / 1000);
        const thread = threads.find(t => t.peerPubkey === peerPubkey);
        // Use the thread's last message time to be precise, or just NOW.
        // Using NOW is safer to cover everything visible.
        const newMap = { ...lastReadMap, [peerPubkey]: now };
        saveLastRead(newMap);
    };

    return (
        <InboxContext.Provider value={{
            threads: threadsWithStatus,
            unreadCount,
            isOpen,
            openInbox,
            closeInbox,
            toggleInbox,
            markThreadAsRead,
            loading,
            onlyTrusted,
            setOnlyTrusted: updateOnlyTrusted
        }}>
            {children}
        </InboxContext.Provider>
    );
}

export function useInbox() {
    const context = useContext(InboxContext);
    if (context === undefined) {
        throw new Error("useInbox must be used within an InboxProvider");
    }
    return context;
}
