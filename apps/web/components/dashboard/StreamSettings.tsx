"use client";

import { useState, useEffect } from "react";
import { useIdentity } from "@/context/IdentityContext";
import { useNostrStreams } from "@/hooks/useNostrStreams";
import { finalizeEvent } from "nostr-tools";
import { publishEvent } from "@/lib/nostr";
import { Save, Radio, Globe, Lock, Loader2, DollarSign, Plus, Trash2 } from "lucide-react";

export function StreamSettings() {
    const { identity } = useIdentity();
    const { streams } = useNostrStreams(); // To get current state if possible, though easier to just manage local state

    // Search current user's stream in the list (if any)
    const myStream = streams.find(s => s.pubkey === identity?.nostrPublicKey);

    const [title, setTitle] = useState("");
    const [summary, setSummary] = useState("");
    const [tags, setTags] = useState("");
    const [escrowAmount, setEscrowAmount] = useState("0");
    const [contentWarning, setContentWarning] = useState("");
    const [venmoHandle, setVenmoHandle] = useState("");
    const [cashAppTag, setCashAppTag] = useState("");
    const [paypalLink, setPaypalLink] = useState("");
    const [customServices, setCustomServices] = useState<{ name: string, value: string }[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    // Initialize form with existing data when available
    useEffect(() => {
        if (myStream) {
            setTitle(myStream.metadata.title || "");
            setSummary(myStream.metadata.summary || "");
            setTags(myStream.metadata.tags?.join(", ") || "");
            setEscrowAmount(myStream.metadata.escrow_amount?.toString() || "0");
            setContentWarning(myStream.metadata.content_warning || "");
            // Payment methods from custom tags
            setVenmoHandle((myStream.metadata as any).venmo || "");
            setCashAppTag((myStream.metadata as any).cashapp || "");
            setPaypalLink((myStream.metadata as any).paypal || "");
            // Custom payment services
            setCustomServices((myStream.metadata as any).customPayments || []);
        }
    }, [myStream?.stream_id]); // Dependency on stream_id to update when loaded

    const handleSave = async () => {
        if (!identity?.nostrPrivateKey) {
            alert("You must be logged in with a private key to update stream settings.");
            return;
        }

        setIsSaving(true);
        try {
            const hexToBytes = (hex: string) => {
                const bytes = new Uint8Array(hex.length / 2);
                for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
                return bytes;
            };

            const tagList = tags.split(",").map(t => t.trim()).filter(Boolean);
            const streamId = myStream?.stream_id || `stream-${identity.nostrPublicKey?.substring(0, 8)}`; // Use existing or generate generic ID

            // Kind 30078: Application specific data? Or standard Stream kind? 
            // Standard NIP-53 uses Kind 30311 (Live Event). 
            // Wait, dStream uses Kind 30311 for the stream metadata.
            // Let's assume we are updating the Kind 30311 event.

            const eventTags = [
                ['d', streamId],
                ['title', title],
                ['summary', summary],
                ['image', myStream?.metadata.image || ""], // Keep image if exists
                ['streaming', (myStream?.metadata as any)?.streaming || ""], // Keep URL if exists
                ['t', 'dstream'],
                ...tagList.map(t => ['t', t])
            ];

            // Escrow & Monero custom tags
            if (escrowAmount && parseFloat(escrowAmount) > 0) {
                eventTags.push(['escrow_amount', escrowAmount]);
            }
            if (identity.moneroAddress) {
                // Assuming identity context has it, or we rely on profile.
                // It's safer to put it in the event if we want listeners to know where to pay.
                // Ideally we check if identity has it. 
                // For now, let's skip auto-adding unless we have a field for it here?
                // Let's rely on the profile metadata for address, but for escrow specifically we might want it here.
            }
            if (contentWarning) {
                eventTags.push(['content_warning', contentWarning]);
            }

            if (venmoHandle) eventTags.push(['venmo', venmoHandle]);
            if (cashAppTag) eventTags.push(['cashapp', cashAppTag]);
            if (paypalLink) eventTags.push(['paypal', paypalLink]);

            // Custom payment services - stored as JSON in a single tag
            if (customServices.length > 0) {
                eventTags.push(['customPayments', JSON.stringify(customServices)]);
            }

            // We need to preserve status as 'live' or whatever it was?
            // NIP-53 says status is in 'status' tag: 'live', 'ended', 'planned'.
            eventTags.push(['status', 'live']);

            const event = {
                kind: 30311,
                created_at: Math.floor(Date.now() / 1000),
                tags: eventTags,
                content: "" // Content usually empty or simple description for old clients
            };

            const signed = finalizeEvent(event, hexToBytes(identity.nostrPrivateKey));
            await publishEvent(signed);
            alert("Stream settings updated! It may take a moment to propagate.");

        } catch (e) {
            console.error("Failed to save stream settings", e);
            alert("Error saving settings. Check console.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
                <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <Radio className="w-6 h-6 text-blue-500" />
                    Stream Lifecycle (Metadata)
                </h3>

                <div className="grid gap-6">
                    <div>
                        <label className="block text-sm font-medium text-neutral-400 mb-2">Stream Title</label>
                        <input
                            type="text"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="My Awesome Stream"
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-neutral-400 mb-2">Summary / Bio</label>
                        <textarea
                            value={summary}
                            onChange={e => setSummary(e.target.value)}
                            placeholder="What is this stream about?"
                            rows={3}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-neutral-400 mb-2">Tags (comma separated)</label>
                        <div className="relative">
                            <Globe className="absolute left-3 top-3 w-5 h-5 text-neutral-600" />
                            <input
                                type="text"
                                value={tags}
                                onChange={e => setTags(e.target.value)}
                                placeholder="gaming, coding, politics"
                                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-10 pr-4 py-3 text-white focus:outline-none focus:border-blue-500"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-orange-400 mb-2">Escrow Amount (XMR)</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-3 w-5 h-5 text-neutral-600" />
                                <input
                                    type="number"
                                    step="0.01"
                                    value={escrowAmount}
                                    onChange={e => setEscrowAmount(e.target.value)}
                                    placeholder="0.00"
                                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-10 pr-4 py-3 text-white focus:outline-none focus:border-orange-500"
                                />
                            </div>
                            <p className="text-xs text-neutral-500 mt-2">Required stake for untrusted viewers. Set to 0 to disable.</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-red-400 mb-2">Content Warning</label>
                            <input
                                type="text"
                                value={contentWarning}
                                onChange={e => setContentWarning(e.target.value)}
                                placeholder="E.g. Nudity, Violence (leave empty if safe)"
                                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500"
                            />
                        </div>
                    </div>

                    {/* Payment Methods Section */}
                    <div className="border-t border-neutral-800 pt-6 mt-6">
                        <h4 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <DollarSign className="w-5 h-5 text-green-500" />
                            Payment Methods (Tips)
                        </h4>
                        <p className="text-xs text-neutral-500 mb-4">Add your payment handles so viewers can tip you. Leave blank to hide.</p>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-blue-400 mb-2">Venmo</label>
                                <input
                                    type="text"
                                    value={venmoHandle}
                                    onChange={e => setVenmoHandle(e.target.value)}
                                    placeholder="@username"
                                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-green-400 mb-2">CashApp</label>
                                <input
                                    type="text"
                                    value={cashAppTag}
                                    onChange={e => setCashAppTag(e.target.value)}
                                    placeholder="$cashtag"
                                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-green-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-yellow-400 mb-2">PayPal.me</label>
                                <input
                                    type="text"
                                    value={paypalLink}
                                    onChange={e => setPaypalLink(e.target.value)}
                                    placeholder="paypal.me/username"
                                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-yellow-500"
                                />
                            </div>
                        </div>

                        {/* Custom Payment Services */}
                        <div className="mt-6 pt-4 border-t border-neutral-800">
                            <div className="flex items-center justify-between mb-3">
                                <label className="text-sm font-medium text-purple-400">Custom Payment Services</label>
                                <button
                                    type="button"
                                    onClick={() => setCustomServices([...customServices, { name: '', value: '' }])}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-purple-900/30 text-purple-400 rounded-lg text-xs hover:bg-purple-900/50 transition"
                                >
                                    <Plus className="w-3 h-3" /> Add Service
                                </button>
                            </div>

                            {customServices.length === 0 ? (
                                <p className="text-xs text-neutral-500 italic">No custom services added. Click "Add Service" to add one.</p>
                            ) : (
                                <div className="space-y-3">
                                    {customServices.map((service, idx) => (
                                        <div key={idx} className="flex gap-2 items-center">
                                            <input
                                                type="text"
                                                value={service.name}
                                                onChange={e => {
                                                    const updated = [...customServices];
                                                    updated[idx].name = e.target.value;
                                                    setCustomServices(updated);
                                                }}
                                                placeholder="Service name (e.g., Bitcoin)"
                                                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                                            />
                                            <input
                                                type="text"
                                                value={service.value}
                                                onChange={e => {
                                                    const updated = [...customServices];
                                                    updated[idx].value = e.target.value;
                                                    setCustomServices(updated);
                                                }}
                                                placeholder="Address or link"
                                                className="flex-[2] bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setCustomServices(customServices.filter((_, i) => i !== idx))}
                                                className="p-2 text-neutral-500 hover:text-red-500 transition"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="mt-4 w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                        Publish Stream Settings (Kind 30311)
                    </button>
                </div>
            </div>
        </div>
    );
}
