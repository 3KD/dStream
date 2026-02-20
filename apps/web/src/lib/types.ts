/**
 * Core Types for dStream
 * 
 * These are the fundamental data structures used throughout the application.
 * All other modules should import from here to maintain consistency.
 */

// ============ IDENTITY ============

export interface Identity {
    /** Nostr public key (hex) */
    publicKey: string;
    /** Nostr private key (hex) - only available if locally generated */
    privateKey?: string;
    /** Display name */
    displayName?: string;
    /** Profile picture URL */
    avatar?: string;
    /** NIP-05 identifier (e.g. user@dstream.stream) */
    nip05?: string;
    /** Whether identity is from extension (NIP-07) */
    isExtension: boolean;
    /** Monero wallet address */
    moneroAddress?: string;
}

// ============ STREAMS ============

export type StreamStatus = 'offline' | 'starting' | 'live' | 'ending';

export interface Stream {
    /** Unique stream identifier (used in URLs) */
    id: string;
    /** Stream title */
    title: string;
    /** Broadcaster's public key */
    broadcasterPubkey: string;
    /** Current status */
    status: StreamStatus;
    /** When the stream started (Unix timestamp) */
    startedAt?: number;
    /** Viewer count (approximate) */
    viewerCount: number;
    /** Stream thumbnail/preview URL */
    thumbnail?: string;
    /** Content tags */
    tags: string[];
    /** Optional description */
    description?: string;
    /** Custom streaming URL (HLS/m3u8) provided by broadcaster */
    streamingUrl?: string;
}

export interface BroadcastSession {
    /** Stream key used for WHIP */
    streamKey: string;
    /** Stream metadata */
    stream: Stream;
    /** Local media stream reference */
    mediaStream?: MediaStream;
    /** WHIP connection status */
    connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
    /** Error message if any */
    error?: string;
}

// ============ CHAT ============

export interface ChatMessage {
    /** Nostr event ID */
    id: string;
    /** Sender's public key */
    senderPubkey: string;
    /** Message content (decrypted if was encrypted) */
    content: string;
    /** Unix timestamp */
    timestamp: number;
    /** Whether message is encrypted (DM/whisper) */
    isEncrypted: boolean;
    /** Whether sender is the broadcaster */
    isBroadcaster: boolean;
    /** Whether sender is a moderator */
    isModerator: boolean;
}

// ============ PAYMENTS ============

export interface PaymentMethod {
    type: 'monero' | 'lightning' | 'custom';
    address?: string;
    label?: string;
}

export interface Tip {
    /** Unique identifier */
    id: string;
    /** Sender public key */
    senderPubkey: string;
    /** Amount in smallest unit */
    amount: number;
    /** Currency/type */
    currency: string;
    /** Optional message */
    message?: string;
    /** Unix timestamp */
    timestamp: number;
    /** Verification status */
    verified: boolean;
}

// ============ NOSTR ============

export const NOSTR_KINDS = {
    METADATA: 0,
    TEXT_NOTE: 1,
    RECOMMEND_RELAY: 2,
    CONTACTS: 3,
    ENCRYPTED_DM: 4,
    DELETE: 5,
    REPOST: 6,
    REACTION: 7,
    // NIP-53 Live Events
    STREAM_ANNOUNCE: 30311,
    STREAM_CHAT: 1311,
    // Custom
    PRESENCE: 30312,
    WHISPER: 20004,
    GUILD: 30078,
    GUILD_MEMBER: 30079,
} as const;

// ============ CONFIG ============

export interface AppConfig {
    relays: string[];
    mediaServer: {
        whipUrl: string;
        hlsUrl: string;
    };
    features: {
        p2p: boolean;
        chat: boolean;
        tips: boolean;
    };
}
