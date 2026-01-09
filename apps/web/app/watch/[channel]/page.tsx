"use client";

import { useEffect, useState } from "react";
import { VideoPlayer } from "@/components/player/VideoPlayer";
import { TipButton } from "@/components/tipping/TipButton";
import { PaymentButtons } from "@/components/tipping/PaymentButtons";
import { ChatBox } from "@/components/chat/ChatBox";
import Link from "next/link";
import { IdentityBadge } from "@/components/identity/IdentityBadge";
import { KeyringActions } from "@/components/identity/KeyringActions";
import { WalletBadge } from "@/components/identity/WalletBadge";
import { Header } from "@/components/layout/Header";
import { P2PStats } from "@/components/P2PStats";
import { Users } from "lucide-react";
import { useTrustedPeers } from "@/context/TrustedPeersContext";
import { useEscrow } from "@/context/EscrowContext";
import { StakingModal } from "@/components/staking/StakingModal";
import { useSearchParams } from "next/navigation";
import { useNostrStreams } from "@/hooks/useNostrStreams"; // Import hook
import { Clock, Tag as TagIcon, Globe, AlertTriangle, Lock, Ticket, Mail, Heart } from "lucide-react"; // Import icons
import { useFavorites } from "@/context/FavoritesContext";
import { Nip05Badge } from "@/components/identity/Nip05Badge";
import { GuildBadges } from "@/components/identity/GuildBadges";
import { useStream } from "@/context/StreamContext";
import { usePresence } from "@/hooks/usePresence";
import { P2PPlayer } from "@/components/p2p/P2PPlayer";

// For MVP, we point to /hls which is proxied to localhost:8880
const STREAM_BASE_URL = "/hls";
const REGISTRY_URL = "http://localhost:3002";

interface WatchPageProps {
    params: Promise<{ channel: string }>;
}

export default function WatchPage({ params }: WatchPageProps) {
    const [channel, setChannel] = useState<string | null>(null);
    const { viewerCount } = usePresence(channel || undefined);
    const [requiredStake, setRequiredStake] = useState(0.01);
    const [broadcasterAddress, setBroadcasterAddress] = useState<string | null>(null);
    const { isTrusted } = useTrustedPeers();
    const searchParams = useSearchParams();
    const pubkey = searchParams.get("pubkey");
    const { isStaked, isSlashed, slash } = useEscrow();
    const { isFavorite, toggleFavorite } = useFavorites();
    const isFavorited = channel ? isFavorite(channel) : false;

    // P2P State
    const [isP2P, setIsP2P] = useState(false);
    const [p2pStatus, setP2pStatus] = useState("Idle");

    useEffect(() => {
        params.then(p => setChannel(p.channel));
    }, [params]);

    // Nostr Metadata
    const { streams } = useNostrStreams();
    const activeStream = streams.find(s => s.stream_id === channel); // Find stream by ID

    // Derived Metadata
    const streamTitle = activeStream?.metadata.title || channel || "Untitled Stream";
    const streamBio = activeStream?.metadata.summary;
    const streamTags = activeStream?.metadata.tags || [];
    const streamLang = activeStream?.metadata.language;
    const contentWarning = activeStream?.metadata.content_warning;
    const startTime = activeStream?.metadata.starts;
    const price = activeStream?.metadata.price;
    const term = activeStream?.metadata.term;

    // Get escrow settings from Nostr metadata (fallback to defaults)
    const nostrEscrowAmount = activeStream?.metadata.escrow_amount;
    const nostrMoneroAddress = activeStream?.metadata.monero_address;

    // Sync with Global Stream Context
    const { playStream } = useStream();

    useEffect(() => {
        if (activeStream && channel) {
            playStream(
                `${STREAM_BASE_URL}/${channel}/index.m3u8`,
                {
                    title: activeStream.metadata.title || "Untitled Stream",
                    pubkey: activeStream.pubkey,
                    channel: channel,
                    summary: activeStream.metadata.summary
                }
            );
        }
    }, [activeStream, channel]); // Only re-sync if the primary stream changes

    // Update broadcaster address from Nostr when available
    useEffect(() => {
        if (nostrMoneroAddress) {
            setBroadcasterAddress(nostrMoneroAddress);
        }
        if (nostrEscrowAmount) {
            setRequiredStake(nostrEscrowAmount);
        }
    }, [nostrMoneroAddress, nostrEscrowAmount]);

    // Ticketing Logic
    const [hasTicket, setHasTicket] = useState(false);
    const [isReconnecting, setIsReconnecting] = useState(false);

    useEffect(() => {
        if (!channel) return;

        const checkTicket = () => {
            // 1. Check for Channel-specific ticket
            const channelTicketKey = `ticket_${channel}`;
            const storedChannelTicket = localStorage.getItem(channelTicketKey);

            // 2. Check for Identity-specific ticket (Failsafe for reconnects)
            const pubkeyTicketKey = pubkey ? `ticket_pub_${pubkey}` : null;
            const storedPubkeyTicket = pubkeyTicketKey ? localStorage.getItem(pubkeyTicketKey) : null;

            const validTicket = (storedData: string | null) => {
                if (!storedData) return false;
                const ticket = JSON.parse(storedData);
                return ticket.expiry > Date.now();
            };

            if (validTicket(storedChannelTicket) || validTicket(storedPubkeyTicket)) {
                setHasTicket(true);
            } else {
                setHasTicket(false);
            }
        };

        checkTicket();
        const interval = setInterval(checkTicket, 10000); // Check every 10s
        return () => clearInterval(interval);
    }, [channel, pubkey]);

    // Reconnection Grace Period Logic
    useEffect(() => {
        if (price && !activeStream && hasTicket) {
            // Stream was active but disappeared - start grace period
            setIsReconnecting(true);
            const timer = setTimeout(() => {
                setIsReconnecting(false);
            }, 10000); // 10s grace period
            return () => clearTimeout(timer);
        } else if (activeStream) {
            setIsReconnecting(false);
        }
    }, [activeStream, price, hasTicket]);

    const [showPurchaseConfirm, setShowPurchaseConfirm] = useState(false);
    const [purchaseComplete, setPurchaseComplete] = useState(false);

    const handlePurchase = () => {
        // Show confirmation step
        setShowPurchaseConfirm(true);
    };

    const confirmPurchase = () => {
        // Mock Purchase Flow for MVP
        const expiry = Date.now() + (term?.value || 24) * 60 * 60 * 1000;
        const ticket = {
            channel,
            pubkey,
            expiry,
            purchasedAt: Date.now()
        };

        // Save by Channel ID
        localStorage.setItem(`ticket_${channel}`, JSON.stringify(ticket));

        // Save by Pubkey (Identity Failsafe)
        if (pubkey) {
            localStorage.setItem(`ticket_pub_${pubkey}`, JSON.stringify(ticket));
        }

        setPurchaseComplete(true);
        setTimeout(() => {
            setHasTicket(true);
            setShowPurchaseConfirm(false);
            setPurchaseComplete(false);
        }, 1500);
    };

    // Registry fetch removed (using Nostr metadata only)
    useEffect(() => {
        // No-op for now, or real-time viewer count from Nostr/Relay in future
    }, []);

    // Gating Logic
    const requiresEscrow = pubkey && !isTrusted(pubkey);
    const showModal = requiresEscrow && !isStaked && !isSlashed;

    // Simulate Slash (Dev only)
    const handleSimulateLeech = () => {
        if (confirm("Simulate downloading too much without uploading?")) {
            slash();
        }
    };

    if (!channel) {
        return <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center">Loading...</div>;
    }

    const streamUrl = `${STREAM_BASE_URL}/${channel}/index.m3u8`;

    return (
        <div className="min-h-screen bg-neutral-950 text-white p-6 relative">
            {(showModal || isSlashed) && <StakingModal requiredAmount={requiredStake} broadcasterAddress={broadcasterAddress} />}

            <Header>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-neutral-400 text-sm">
                        <Users className="w-4 h-4" />
                        <span>{viewerCount} watching</span>
                    </div>

                    <KeyringActions />
                    <WalletBadge />
                </div>
            </Header>

            <main className={`max-w-7xl mx-auto transition-all ${((showModal || isSlashed) ? 'blur-sm opacity-50 pointer-events-none' : '')}`}>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-4">
                        <div className="w-full relative">
                            {price && !hasTicket && !isReconnecting ? (
                                <div className="aspect-video bg-neutral-900 flex flex-col items-center justify-center text-center p-8 border border-neutral-800 rounded-lg">
                                    <Lock className="w-16 h-16 text-neutral-600 mb-4" />
                                    <h2 className="text-2xl font-bold mb-2">Ticket Required</h2>
                                    <p className="text-neutral-400 mb-6 max-w-md">
                                        This stream requires an admission fee to watch.
                                        Purchase a ticket to unlock access for <strong>{term?.value} {term?.unit}</strong>.
                                    </p>

                                    {purchaseComplete ? (
                                        <div className="bg-green-900/30 border border-green-600 text-green-400 px-8 py-3 rounded-full font-bold flex items-center gap-2">
                                            ✓ Payment Received! Unlocking...
                                        </div>
                                    ) : showPurchaseConfirm ? (
                                        <div className="space-y-4 w-full max-w-xs">
                                            <div className="bg-yellow-900/20 border border-yellow-600/50 text-yellow-400 p-4 rounded-lg text-sm">
                                                Confirm payment of <strong>{price.amount} {price.currency}</strong> for {term?.value} {term?.unit} access?
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setShowPurchaseConfirm(false)}
                                                    className="flex-1 bg-neutral-700 hover:bg-neutral-600 text-white px-4 py-3 rounded-full font-bold transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    onClick={confirmPurchase}
                                                    className="flex-1 bg-green-600 hover:bg-green-500 text-white px-4 py-3 rounded-full font-bold transition-colors"
                                                >
                                                    Confirm
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={handlePurchase}
                                            className="bg-green-600 hover:bg-green-500 text-white px-8 py-3 rounded-full font-bold flex items-center gap-2 transition-colors"
                                        >
                                            <Ticket className="w-5 h-5" />
                                            Buy Ticket ({price.amount} {price.currency})
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="w-full h-full relative">
                                    {isP2P && activeStream?.pubkey ? (
                                        <div className="w-full h-full">
                                            <P2PPlayer
                                                broadcasterPubkey={activeStream.pubkey}
                                                onStatusChange={setP2pStatus}
                                            />
                                        </div>
                                    ) : (
                                        <VideoPlayer src={streamUrl} autoPlay={true} />
                                    )}

                                    <div className="absolute top-4 right-4 z-40">
                                        <button
                                            onClick={() => setIsP2P(!isP2P)}
                                            className={`px-3 py-1 rounded text-xs font-bold shadow-lg backdrop-blur-md transition-all ${isP2P
                                                    ? 'bg-purple-600/90 text-white border border-purple-400'
                                                    : 'bg-black/60 text-neutral-300 border border-white/10 hover:bg-black/80'
                                                }`}
                                        >
                                            {isP2P ? `P2P: ${p2pStatus}` : 'Switch to P2P (Beta)'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="space-y-4">
                            {/* Content Warning Banner */}
                            {contentWarning && (
                                <div className="bg-red-900/30 border border-red-600 rounded-lg p-4 flex items-center gap-3">
                                    <AlertTriangle className="w-5 h-5 text-red-500" />
                                    <div>
                                        <p className="font-bold text-red-400">Content Warning</p>
                                        <p className="text-sm text-red-200">{contentWarning}</p>
                                    </div>
                                </div>
                            )}

                            <div>
                                <h1 className="text-3xl font-bold mb-2">{streamTitle}</h1>
                                {activeStream && startTime && (
                                    <div className="flex items-center gap-2 text-red-400 text-sm font-mono mb-4">
                                        <Clock className="w-4 h-4" />
                                        <LiveTimer startTime={startTime * 1000} />
                                    </div>
                                )}


                            </div>

                            <div className="flex gap-4 p-4 border border-white/10 rounded-lg bg-neutral-900">
                                {activeStream?.metadata.image ? (
                                    <img
                                        src={activeStream.metadata.image}
                                        alt={activeStream.metadata.broadcaster_name || "Broadcaster"}
                                        className="w-12 h-12 rounded-full object-cover"
                                        onError={(e) => {
                                            // Hide broken image and show fallback
                                            (e.target as HTMLImageElement).style.display = 'none';
                                            (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                                        }}
                                    />
                                ) : null}
                                <div className={`w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center font-bold text-xl ${activeStream?.metadata.image ? 'hidden' : ''}`}>
                                    {(activeStream?.metadata.broadcaster_name?.[0] || channel?.[0] || '?').toUpperCase()}
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-semibold text-lg">{activeStream?.metadata.broadcaster_name || channel || "Broadcaster"}</h3>
                                        {activeStream?.pubkey && (
                                            <Nip05Badge
                                                pubkey={activeStream.pubkey}
                                                nip05={activeStream.metadata.nip05}
                                                showAddress={true}
                                            />
                                        )}
                                    </div>
                                    {/* Guild Badges */}
                                    {activeStream?.pubkey && (
                                        <GuildBadges pubkey={activeStream.pubkey} className="mt-1" />
                                    )}

                                    {/* Description */}
                                    {streamBio && (
                                        <p className="text-neutral-300 my-2 text-sm leading-relaxed max-w-xl">
                                            {streamBio}
                                        </p>
                                    )}

                                    {/* Tags & Lang */}
                                    <div className="flex flex-wrap gap-2 mt-3">
                                        {streamLang && (
                                            <span className="px-2 py-1 bg-neutral-800 rounded text-xs text-neutral-400 flex items-center gap-1">
                                                <Globe className="w-3 h-3" /> {streamLang.toUpperCase()}
                                            </span>
                                        )}
                                        {streamTags.map(tag => (
                                            <span key={tag} className="px-2 py-1 bg-blue-900/30 text-blue-400 rounded text-xs flex items-center gap-1 border border-blue-800/50">
                                                <TagIcon className="w-3 h-3" /> {tag}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    {channel && (
                                        <button
                                            onClick={() => toggleFavorite(channel)}
                                            className={`p-2.5 rounded-full transition-all border flex items-center gap-2 ${isFavorited ? 'text-red-500 border-red-500/50 bg-red-500/10' : 'text-neutral-400 border-neutral-700 bg-neutral-800 hover:text-red-400 hover:border-red-500/30'}`}
                                            title={isFavorited ? "Unfavorite this channel" : "Favorite this channel"}
                                        >
                                            <Heart className={`w-4 h-4 ${isFavorited ? 'fill-current' : ''}`} />
                                        </button>
                                    )}
                                    {isStaked && (
                                        <div className="text-xs text-green-500 border border-green-900 bg-green-950 px-3 py-2 rounded-full flex items-center font-medium">
                                            Active Stake: {requiredStake} XMR
                                        </div>
                                    )}
                                    <TipButton />
                                    {activeStream && <PaymentButtons stream={activeStream} />}
                                </div>
                            </div>

                            <div className="text-sm text-neutral-500 bg-neutral-900/50 p-3 rounded-lg flex flex-col gap-1">
                                <p><strong>Stream URL:</strong> <span className="font-mono text-xs">{streamUrl}</span></p>
                                <p><strong>Viewers:</strong> {viewerCount} connected</p>
                                <p><strong>Chat:</strong> Messages stored locally on your device</p>
                                <P2PStats className="mt-2 pt-2 border-t border-neutral-800" />
                                {isStaked && (
                                    <button onClick={handleSimulateLeech} className="mt-2 text-red-500 text-xs hover:underline text-left">
                                        [DEV] Simulate Leech / Slash Stake
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="lg:col-span-1">
                        <ChatBox channel={channel} broadcasterPubkey={pubkey || undefined} />
                    </div>
                </div>
            </main >
        </div >
    );
}

function LiveTimer({ startTime }: { startTime: number }) {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        const update = () => {
            const now = Date.now();
            setElapsed(Math.max(0, now - startTime));
        };
        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [startTime]);

    const hours = Math.floor(elapsed / (1000 * 60 * 60));
    const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((elapsed % (1000 * 60)) / 1000);

    return (
        <span className="font-mono">
            Live for {hours > 0 ? `${hours}h ` : ''}{minutes}m {seconds}s
        </span>
    );
}
