"use client";

import { useState } from "react";
import { Zap, Users, Shield, Save, Plus, Trash2, UserPlus, Crown, CheckCircle, XCircle } from "lucide-react";
import { useIdentity } from "@/context/IdentityContext";
import { KIND_GUILD_LIST, useNostrGuilds } from "@/hooks/useNostrGuilds";
import { publishEvent, pool, RELAYS } from "@/lib/nostr";

export function GuildManagement() {
    const { identity, signNostrEvent } = useIdentity();
    const { guilds, loading: guildsLoading } = useNostrGuilds();
    const [guildName, setGuildName] = useState("");
    const [guildDescription, setGuildDescription] = useState("");
    const [featuredPubkey, setFeaturedPubkey] = useState("");
    const [featuredStreamId, setFeaturedStreamId] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [joinGuildId, setJoinGuildId] = useState("");
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    // Editing State
    const [editingGuild, setEditingGuild] = useState<any | null>(null); // Guild object
    const [newMemberPubkey, setNewMemberPubkey] = useState("");

    // Find guilds the user is a member of
    const myGuilds = guilds.filter(g =>
        g.members.includes(identity?.nostrPublicKey || "") ||
        g.pubkey === identity?.nostrPublicKey
    );

    // Guilds the user owns
    const ownedGuilds = guilds.filter(g => g.pubkey === identity?.nostrPublicKey);

    const showFeedback = (type: 'success' | 'error', message: string) => {
        setFeedback({ type, message });
        setTimeout(() => setFeedback(null), 5000);
    };

    const handleEditGuild = (guild: any) => {
        setEditingGuild(guild);
        setGuildName(guild.name);
        setGuildDescription(guild.description);
        setFeaturedPubkey(guild.featured?.pubkey || "");
        setFeaturedStreamId(guild.featured?.stream_id || "");
        // Members are handled directly from guild.members
    };

    const handleCancelEdit = () => {
        setEditingGuild(null);
        setGuildName("");
        setGuildDescription("");
        setFeaturedPubkey("");
        setFeaturedStreamId("");
        setNewMemberPubkey("");
    };

    const handleAddMember = () => {
        if (!editingGuild || !newMemberPubkey.trim()) return;
        // Add to local editing state (optimistic) - actual save happens on "Update Guild"
        const updatedMembers = [...new Set([...editingGuild.members, newMemberPubkey.trim()])];
        setEditingGuild({ ...editingGuild, members: updatedMembers });
        setNewMemberPubkey("");
    };

    const handleRemoveMember = (pubkeyToRemove: string) => {
        if (!editingGuild) return;
        const updatedMembers = editingGuild.members.filter((m: string) => m !== pubkeyToRemove);
        setEditingGuild({ ...editingGuild, members: updatedMembers });
    };

    const handleCreateGuild = async () => {
        if (!identity?.nostrPublicKey) return;
        setIsSaving(true);
        setFeedback(null);

        try {
            const guildId = editingGuild ? editingGuild.id : `${identity.nostrPublicKey.slice(0, 8)}-guild-${Date.now()}`;
            const event = {
                kind: KIND_GUILD_LIST,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ["d", guildId],
                    ["t", "guild"],
                    ["name", guildName],
                    ["description", guildDescription],
                ],
                content: "",
                pubkey: identity.nostrPublicKey
            };

            if (featuredPubkey && featuredStreamId) {
                event.tags.push(["featured", featuredPubkey, featuredStreamId]);
            }

            // Add Members
            if (editingGuild && editingGuild.members) {
                editingGuild.members.forEach((m: string) => {
                    if (m) event.tags.push(["p", m]);
                });
            }

            // Sign the event
            const signedEvent = await signNostrEvent(event);

            // Publish to relays
            const results = await Promise.allSettled(pool.publish(RELAYS, signedEvent));
            const successCount = results.filter(r => r.status === 'fulfilled').length;

            if (successCount > 0) {
                showFeedback('success', `Guild "${guildName}" ${editingGuild ? 'updated' : 'published'} to ${successCount} relay(s)!`);
                handleCancelEdit(); // Reset form
            } else {
                showFeedback('error', 'Failed to publish to any relays. Try again.');
            }

        } catch (e: any) {
            console.error("[Guild] Publish error:", e);
            showFeedback('error', e.message || 'Failed to create guild');
        } finally {
            setIsSaving(false);
        }
    };

    const handleJoinGuild = async () => {
        if (!joinGuildId.trim() || !identity?.nostrPublicKey) return;

        // For now, joining a guild means the guild owner needs to add you
        // We can publish a "join request" as a Kind 30001 with a reference
        // But for simplicity, we'll just show instructions
        showFeedback('success', `To join, ask the guild owner to add your pubkey: ${identity.nostrPublicKey.slice(0, 12)}...`);
        setJoinGuildId("");
    };

    return (
        <div className="space-y-8">
            {/* Feedback Banner */}
            {feedback && (
                <div className={`flex items-center gap-3 p-4 rounded-xl border ${feedback.type === 'success' ? 'bg-green-900/20 border-green-700 text-green-400' : 'bg-red-900/20 border-red-700 text-red-400'}`}>
                    {feedback.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                    <span className="text-sm">{feedback.message}</span>
                </div>
            )}

            {/* My Guilds */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-3 bg-green-500/10 rounded-xl">
                        <Crown className="w-6 h-6 text-green-400" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold">My Guilds</h2>
                        <p className="text-sm text-neutral-500">Guilds you belong to or own</p>
                    </div>
                </div>

                {guildsLoading ? (
                    <div className="text-neutral-500 text-sm">Loading guilds...</div>
                ) : myGuilds.length === 0 ? (
                    <div className="text-neutral-500 text-sm p-4 bg-neutral-950 rounded-lg border border-neutral-800 text-center">
                        You're not a member of any guilds yet. Create your own or join one below!
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {myGuilds.map(guild => (
                            <div
                                key={guild.id}
                                className="p-4 bg-neutral-950 rounded-xl border border-neutral-800 hover:border-purple-500/30 transition"
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <Users className="w-4 h-4 text-purple-400" />
                                    <span className="font-bold">{guild.name}</span>
                                    {guild.pubkey === identity?.nostrPublicKey && (
                                        <span className="text-[10px] px-1.5 py-0.5 bg-yellow-900/30 text-yellow-400 rounded-full">Owner</span>
                                    )}
                                </div>
                                <p className="text-sm text-neutral-400 line-clamp-2">{guild.description || "No description"}</p>
                                <div className="text-xs text-neutral-600 mt-2 font-mono">{guild.members.length} members</div>

                                {guild.pubkey === identity?.nostrPublicKey && (
                                    <button
                                        onClick={() => handleEditGuild(guild)}
                                        className="mt-3 text-xs w-full py-1.5 rounded bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 transition"
                                    >
                                        Manage Guild
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Join Guild */}
                <div className="mt-6 pt-4 border-t border-neutral-800">
                    <h3 className="text-sm font-bold text-neutral-300 mb-3 flex items-center gap-2">
                        <UserPlus className="w-4 h-4 text-blue-400" />
                        Join a Guild
                    </h3>
                    <div className="flex gap-3">
                        <input
                            type="text"
                            value={joinGuildId}
                            onChange={(e) => setJoinGuildId(e.target.value)}
                            placeholder="Paste guild ID (d-tag)"
                            className="flex-1 px-4 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500/50 outline-none"
                        />
                        <button
                            onClick={handleJoinGuild}
                            disabled={!joinGuildId.trim()}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium transition flex items-center gap-2"
                        >
                            <UserPlus className="w-4 h-4" />
                            Join
                        </button>
                    </div>
                </div>
            </div>

            {/* Create Guild */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-3 bg-purple-500/10 rounded-xl">
                        <Users className="w-6 h-6 text-purple-400" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold">{editingGuild ? "Edit Guild" : "Create Guild"}</h2>
                        <p className="text-sm text-neutral-500">{editingGuild ? "Update details and manage members." : "Start your own curation collective."}</p>
                    </div>
                </div>

                <div className="space-y-4">
                    {editingGuild && (
                        <div className="p-4 bg-neutral-950 rounded-xl border border-neutral-800 mb-6">
                            <h3 className="text-sm font-bold text-neutral-300 mb-3 flex items-center gap-2">
                                <Users className="w-4 h-4 text-blue-400" />
                                Manage Members ({editingGuild.members.length})
                            </h3>

                            <div className="flex gap-2 mb-3">
                                <input
                                    type="text"
                                    value={newMemberPubkey}
                                    onChange={(e) => setNewMemberPubkey(e.target.value)}
                                    placeholder="Member Pubkey (hex)"
                                    className="flex-1 px-3 py-2 bg-neutral-900 border border-neutral-800 rounded text-xs font-mono"
                                />
                                <button
                                    onClick={handleAddMember}
                                    disabled={!newMemberPubkey}
                                    className="px-3 py-2 bg-blue-600/20 text-blue-500 hover:bg-blue-600/30 rounded text-xs font-bold disabled:opacity-50"
                                >
                                    Add
                                </button>
                            </div>

                            <div className="max-h-32 overflow-y-auto space-y-1 custom-scrollbar">
                                {editingGuild.members.length === 0 && <span className="text-xs text-neutral-600 italic">No members yet.</span>}
                                {editingGuild.members.map((m: string) => (
                                    <div key={m} className="flex justify-between items-center px-2 py-1 bg-neutral-900 rounded border border-neutral-800/50">
                                        <span className="text-[10px] font-mono text-neutral-400 truncate w-3/4">{m}</span>
                                        <button onClick={() => handleRemoveMember(m)} className="text-red-500 hover:text-red-400">
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-neutral-400 mb-1">Guild Name</label>
                        <input
                            type="text"
                            value={guildName}
                            onChange={(e) => setGuildName(e.target.value)}
                            placeholder="e.g. The Underground Crew"
                            className="w-full px-4 py-2 bg-neutral-950 border border-neutral-800 rounded-lg focus:ring-2 focus:ring-purple-500/50 outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-neutral-400 mb-1">Description</label>
                        <textarea
                            value={guildDescription}
                            onChange={(e) => setGuildDescription(e.target.value)}
                            placeholder="What is this guild about?"
                            className="w-full px-4 py-2 bg-neutral-950 border border-neutral-800 rounded-lg focus:ring-2 focus:ring-purple-500/50 outline-none h-24 resize-none"
                        />
                    </div>

                    <div className="pt-4 border-t border-neutral-800">
                        <h3 className="text-sm font-bold text-neutral-300 mb-4 flex items-center gap-2">
                            <Zap className="w-4 h-4 text-yellow-500" />
                            Featured Stream (Rotation)
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-neutral-400 mb-1">Streamer Pubkey</label>
                                <input
                                    type="text"
                                    value={featuredPubkey}
                                    onChange={(e) => setFeaturedPubkey(e.target.value)}
                                    placeholder="npub or hex"
                                    className="w-full px-4 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm font-mono"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-neutral-400 mb-1">Stream ID (d-tag)</label>
                                <input
                                    type="text"
                                    value={featuredStreamId}
                                    onChange={(e) => setFeaturedStreamId(e.target.value)}
                                    placeholder="e.g. gaming-session-1"
                                    className="w-full px-4 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-sm"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        {editingGuild && (
                            <button
                                onClick={handleCancelEdit}
                                className="flex-1 px-6 py-3 bg-neutral-800 hover:bg-neutral-700 text-white font-bold rounded-xl transition-all"
                            >
                                Cancel
                            </button>
                        )}
                        <button
                            onClick={handleCreateGuild}
                            disabled={!guildName || isSaving}
                            className={`flex-items-center justify-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all active:scale-95 ${editingGuild ? 'flex-1' : 'w-full'}`}
                        >
                            {isSaving ? "Saving..." : <>{editingGuild ? <Save className="w-5 h-5" /> : <Plus className="w-5 h-5" />} {editingGuild ? "Update Guild" : "Create Guild"}</>}
                        </button>
                    </div>
                </div>
            </div>

            {/* Hint Box */}
            <div className="p-4 bg-blue-900/10 border border-blue-900/30 rounded-xl flex gap-3">
                <Shield className="w-6 h-6 text-blue-400 flex-shrink-0" />
                <p className="text-sm text-blue-200/70">
                    Guilds use **Nostr Kind 30001 (Generalized List)** events. When you update your guild,
                    the new list is broadcast to the network. Viewers following your pubkey or the guild ID
                    will see your featured stream automatically.
                </p>
            </div>
        </div>
    );
}
