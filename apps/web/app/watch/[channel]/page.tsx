"use client";

import { useEffect, useState } from "react";
import { VideoPlayer } from "@/components/player/VideoPlayer";
import { TipButton } from "@/components/tipping/TipButton";
import { ChatBox } from "@/components/chat/ChatBox";
import Link from "next/link";
import { IdentityBadge } from "@/components/identity/IdentityBadge";
import { KeyringActions } from "@/components/identity/KeyringActions";
import { WalletBadge } from "@/components/identity/WalletBadge";
import { Users } from "lucide-react";
import { useTrustedPeers } from "@/context/TrustedPeersContext";
import { useEscrow } from "@/context/EscrowContext";
import { StakingModal } from "@/components/staking/StakingModal";
import { useSearchParams } from "next/navigation";
import { useNostrStreams } from "@/hooks/useNostrStreams"; // Import hook
import { Clock, Tag as TagIcon, Globe, AlertTriangle, Lock, Ticket } from "lucide-react"; // Import icons

// For MVP, we point to localhost:8880 (MediaMTX HLS output)
const STREAM_BASE_URL = "http://localhost:8880";
const REGISTRY_URL = "http://localhost:3002";

interface WatchPageProps {
    params: Promise<{ channel: string }>;
}

export default function WatchPage({ params }: WatchPageProps) {
    const [channel, setChannel] = useState<string | null>(null);
    const [viewerCount, setViewerCount] = useState(0);
    const [requiredStake, setRequiredStake] = useState(0.01);
    const [broadcasterAddress, setBroadcasterAddress] = useState<string | null>(null);
    const { isTrusted } = useTrustedPeers();
    const searchParams = useSearchParams();
    const pubkey = searchParams.get("pubkey");
    const { isStaked, isSlashed, slash } = useEscrow();

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

    // Ticketing Logic
    const [hasTicket, setHasTicket] = useState(false);

    useEffect(() => {
        if (!channel) return;
        // Check local storage for valid ticket
        const ticketKey = `ticket_${channel}`;
        const storedTicket = localStorage.getItem(ticketKey);
        if (storedTicket) {
            const ticket = JSON.parse(storedTicket);
            // Check expiry
            if (ticket.expiry > Date.now()) {
                setHasTicket(true);
            } else {
                localStorage.removeItem(ticketKey);
            }
        }
    }, [channel]);

    const handlePurchase = () => {
        // Mock Purchase Flow for MVP
        // In real version: Send Kind 4 DM -> Wait for Reply
        if (confirm(`Confirm payment of ${price?.amount} ${price?.currency} for ${term?.value} ${term?.unit} access?`)) {
            const expiry = Date.now() + (term?.value || 24) * 60 * 60 * 1000;
            const ticket = {
                channel,
                expiry,
                purchasedAt: Date.now()
            };
            localStorage.setItem(`ticket_${channel}`, JSON.stringify(ticket));
            setHasTicket(true);
            alert("Payment Sent! Ticket Received. Enjoy the stream.");
        }
    };

    // Fetch stream metadata
    useEffect(() => {
        if (!channel) return;

        const fetchDetails = async () => {
            try {
                // Fetch viewers
                const viewersRes = await fetch(`${REGISTRY_URL}/viewers/${channel}`);
                const viewersData = await viewersRes.json();
                setViewerCount(viewersData.viewers || 0);

                // Fetch Metadata (Escrow Amount)
                const streamRes = await fetch(`${REGISTRY_URL}/stream/${channel}`);
                if (streamRes.ok) {
                    const streamData = await streamRes.json();
                    // Update the StakingModal default via prop or context?
                    // For now, let's store it locally and pass to StakingModal if we refactor,
                    // But StakingModal pulls from EscrowContext. 
                    // WE need to update StakingModal to accept an "amount" prop.
                    if (streamData.metadata?.escrow_amount) {
                        setRequiredStake(streamData.metadata.escrow_amount);
                    }
                    if (streamData.metadata?.monero_address) {
                        setBroadcasterAddress(streamData.metadata.monero_address);
                    }
                }
            } catch (e) {
                // Silently fail
            }
        };

        fetchDetails();
        const interval = setInterval(fetchDetails, 5000);
        return () => clearInterval(interval);
    }, [channel]);

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

            <header className="mb-6 flex items-center justify-between">
                <Link href="/" className="text-xl font-bold tracking-tight bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
                    dStream
                </Link>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-neutral-400 text-sm">
                        <Users className="w-4 h-4" />
                        <span>{viewerCount} watching</span>
                    </div>
                    {isStaked && (
                        <div className="text-xs text-green-500 border border-green-900 bg-green-950 px-2 py-1 rounded">
                            Stake Active: {requiredStake} XMR
                        </div>
                    )}
                    <KeyringActions />
                    <WalletBadge />
                    <IdentityBadge />
                </div>
            </header>

            <main className={`max-w-7xl mx-auto transition-all ${((showModal || isSlashed) ? 'blur-sm opacity-50 pointer-events-none' : '')}`}>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-4">
                        <div className="w-full relative">
                            {price && !hasTicket ? (
                                <div className="aspect-video bg-neutral-900 flex flex-col items-center justify-center text-center p-8 border border-neutral-800 rounded-lg">
                                    <Lock className="w-16 h-16 text-neutral-600 mb-4" />
                                    <h2 className="text-2xl font-bold mb-2">Ticket Required</h2>
                                    <p className="text-neutral-400 mb-6 max-w-md">
                                        This stream requires an admission fee to watch.
                                        Purchase a ticket to unlock access for <strong>{term?.value} {term?.unit}</strong>.
                                    </p>
                                    <button
                                        onClick={handlePurchase}
                                        className="bg-green-600 hover:bg-green-500 text-white px-8 py-3 rounded-full font-bold flex items-center gap-2 transition-colors"
                                    >
                                        <Ticket className="w-5 h-5" />
                                        Buy Ticket ({price.amount} {price.currency})
                                    </button>
                                </div>
                            ) : (
                                <VideoPlayer src={streamUrl} autoPlay={true} />
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
                                <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center font-bold text-xl">
                                    {channel ? channel[0].toUpperCase() : '?'}
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-semibold text-lg">Broadcaster</h3>

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
                                <TipButton />
                            </div>

                            <div className="text-sm text-neutral-500 bg-neutral-900/50 p-3 rounded-lg flex flex-col gap-1">
                                <p><strong>Stream URL:</strong> <span className="font-mono text-xs">{streamUrl}</span></p>
                                <p><strong>Viewers:</strong> {viewerCount} connected</p>
                                <p><strong>Chat:</strong> Messages stored locally on your device</p>
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
            </main>
        </div>
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
