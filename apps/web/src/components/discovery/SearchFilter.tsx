"use client";

import { Search, Tag, X, Zap } from "lucide-react";

interface SearchFilterProps {
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    selectedCategory: string | null;
    setSelectedCategory: (category: string | null) => void;
    onSearch?: (query: string) => void;
}

const CATEGORIES = [
    "Gaming",
    "Music",
    "IRL",
    "Tech",
    "Crypto",
    "News",
    "Art"
];

export function SearchFilter({ searchQuery, setSearchQuery, selectedCategory, setSelectedCategory, onSearch }: SearchFilterProps) {
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && onSearch) {
            onSearch(searchQuery);
        }
    };

    return (
        <div className="w-full max-w-4xl mx-auto space-y-4 mb-10">
            {/* Search Bar */}
            <div className="relative group">
                <button
                    onClick={() => onSearch?.(searchQuery)}
                    className="absolute inset-y-0 left-0 pl-5 flex items-center cursor-pointer z-10"
                    title="Search Global Network"
                >
                    <Search className="h-4 w-4 text-neutral-500 group-focus-within:text-blue-500 transition-colors hover:text-white" />
                </button>
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="block w-full pl-12 pr-12 py-3.5 bg-neutral-800 border border-transparent rounded-full font-mono text-sm placeholder-neutral-600 text-neutral-300 focus:outline-none focus:bg-neutral-700/50 focus:border-neutral-700 focus:ring-1 focus:ring-blue-500/30 transition-all shadow-lg shadow-black/20"
                    placeholder="Type to filter... Press Enter to search global network"
                />
                {searchQuery && (
                    <button
                        onClick={() => setSearchQuery("")}
                        className="absolute inset-y-0 right-0 pr-4 flex items-center text-neutral-500 hover:text-white"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {/* Categories */}
            <div className="flex flex-wrap gap-2 justify-center">
                <button
                    onClick={() => setSelectedCategory(null)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${selectedCategory === null
                        ? "bg-white text-black shadow-lg shadow-white/10 scale-105"
                        : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-white border border-neutral-800"
                        }`}
                >
                    All
                </button>
                <button
                    onClick={() => setSelectedCategory("Guilds")}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${selectedCategory === "Guilds"
                        ? "bg-purple-600 text-white shadow-lg shadow-purple-500/20 scale-105"
                        : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-white border border-neutral-800"
                        }`}
                >
                    <Zap className={`w-3 h-3 ${selectedCategory === "Guilds" ? "fill-current" : ""}`} />
                    Guilds
                </button>
                {CATEGORIES.map(cat => (
                    <button
                        key={cat}
                        onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${selectedCategory === cat
                            ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20 scale-105"
                            : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-white border border-neutral-800"
                            }`}
                    >
                        {selectedCategory === cat && <Tag className="w-3 h-3" />}
                        {cat}
                    </button>
                ))}
            </div>
        </div>
    );
}
