"use client";
import { Guild } from '@/hooks/useNostrGuilds';

interface GuildBadgeProps {
    guild: Guild;
    size?: 'sm' | 'md';
}

export function GuildBadge({ guild, size = 'sm' }: GuildBadgeProps) {
    const sizeClasses = {
        sm: 'w-5 h-5 text-[10px]',
        md: 'w-8 h-8 text-xs',
    };

    return (
        <div
            className={`${sizeClasses[size]} rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center overflow-hidden`}
            title={guild.name}
        >
            {guild.image ? (
                <img src={guild.image} alt={guild.name} className="w-full h-full object-cover" />
            ) : (
                <span className="font-bold text-white">
                    {guild.name.charAt(0).toUpperCase()}
                </span>
            )}
        </div>
    );
}
