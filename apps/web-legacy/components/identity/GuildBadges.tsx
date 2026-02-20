"use client";

import { Users } from "lucide-react";
import { useNostrGuilds } from "@/hooks/useNostrGuilds";

interface GuildBadgesProps {
    pubkey: string;
    compact?: boolean;
    maxBadges?: number;
    className?: string;
}

/**
 * Display guild badges for a given user pubkey.
 * Shows guilds where the user is either a member or the owner.
 */
export function GuildBadges({ pubkey, compact = false, maxBadges = 3, className = "" }: GuildBadgesProps) {
    const { guilds, loading } = useNostrGuilds();

    if (loading || !pubkey) return null;

    // Find guilds this user belongs to
    const userGuilds = guilds.filter(g =>
        g.members.includes(pubkey) || g.pubkey === pubkey
    );

    if (userGuilds.length === 0) return null;

    const displayGuilds = userGuilds.slice(0, maxBadges);
    const remainingCount = userGuilds.length - displayGuilds.length;

    if (compact) {
        return (
            <div className={`flex items-center gap-1 ${className}`}>
                {displayGuilds.map(guild => (
                    <span
                        key={guild.id}
                        className="text-[10px] px-1.5 py-0.5 bg-purple-900/40 text-purple-300 border border-purple-800/50 rounded-full flex items-center gap-1"
                        title={guild.name}
                    >
                        <Users className="w-2.5 h-2.5" />
                        {guild.name.length > 10 ? guild.name.substring(0, 10) + "..." : guild.name}
                    </span>
                ))}
                {remainingCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-neutral-800 text-neutral-400 rounded-full">
                        +{remainingCount}
                    </span>
                )}
            </div>
        );
    }

    return (
        <div className={`flex flex-wrap items-center gap-2 ${className}`}>
            {displayGuilds.map(guild => (
                <span
                    key={guild.id}
                    className="text-xs px-2 py-1 bg-purple-900/30 text-purple-300 border border-purple-800/50 rounded-lg flex items-center gap-1.5"
                    title={`Member of ${guild.name}`}
                >
                    <Users className="w-3 h-3" />
                    {guild.name}
                </span>
            ))}
            {remainingCount > 0 && (
                <span className="text-xs px-2 py-1 bg-neutral-800 text-neutral-400 rounded-lg">
                    +{remainingCount} more
                </span>
            )}
        </div>
    );
}
