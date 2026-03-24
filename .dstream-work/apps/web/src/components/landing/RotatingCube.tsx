"use client";

import { useEffect, useState, useRef } from "react";
import {
    ShieldCheck, Unlock, Users, EyeOff, Network,
    Globe, PenTool, Megaphone, Music, Camera,
    Gamepad, Flag, type LucideIcon
} from "lucide-react";

export const WORDS = [
    "Decentralized",
    "Unstoppable",
    "P2P",
    "Ownerless",
    "Private",
    "Permissionless",
    "Global",
    "Journalism",
    "Activism",
    "Music",
    "Gamer",
    "Influencer",
    "Independent"
];

// Icon + color for each word
const WORD_ICONS: Record<string, { icon?: LucideIcon; img?: string; color: string }> = {
    "Decentralized": { img: "/logo_trimmed.png", color: "text-purple-400" },
    "Unstoppable": { icon: ShieldCheck, color: "text-green-400" },
    "Permissionless": { icon: Unlock, color: "text-yellow-400" },
    "Ownerless": { icon: Users, color: "text-blue-400" },
    "Private": { icon: EyeOff, color: "text-red-400" },
    "P2P": { icon: Network, color: "text-cyan-400" },
    "Global": { icon: Globe, color: "text-emerald-400" },
    "Journalism": { icon: PenTool, color: "text-orange-400" },
    "Activism": { icon: Megaphone, color: "text-pink-400" },
    "Music": { icon: Music, color: "text-violet-400" },
    "Influencer": { icon: Camera, color: "text-rose-400" },
    "Gamer": { icon: Gamepad, color: "text-lime-400" },
    "Independent": { icon: Flag, color: "text-amber-400" },
};

// Hex colors for CSS transitions (Tailwind classes don't animate)
export const WORD_COLORS_HEX: Record<string, string> = {
    "Decentralized": "#ffffff", // white
    "Unstoppable": "#4ade80", // green-400
    "Permissionless": "#facc15", // yellow-400
    "Ownerless": "#60a5fa", // blue-400
    "Private": "#f87171", // red-400
    "P2P": "#22d3ee", // cyan-400
    "Global": "#34d399", // emerald-400
    "Journalism": "#fb923c", // orange-400
    "Activism": "#f472b6", // pink-400
    "Music": "#a78bfa", // violet-400
    "Influencer": "#fb7185", // rose-400
    "Gamer": "#a3e635", // lime-400
    "Independent": "#fbbf24", // amber-400
};

/**
 * RotatingCube - Clean implementation from scratch
 * 
 * KEY PRINCIPLE: 4 physical faces store 4 words as STATE.
 * Words are LOCKED to their physical face.
 * CSS rotation brings different faces into view.
 * We only update the BACK face (hidden from view) before rotation starts.
 */
interface RotatingCubeProps {
    onWordChange?: (word: string) => void;
}

export function RotatingCube({ onWordChange }: RotatingCubeProps) {
    // CSS rotation angle (multiples of 90)
    const [rotationCount, setRotationCount] = useState(0);

    // Is cube currently lifted?
    const [isLifted, setIsLifted] = useState(false);

    // The 4 physical faces with their FIXED words
    // Index: 0=Front, 1=Bottom, 2=Back, 3=Top (in initial position)
    // Sequence of appearance: 0 -> 3 -> 2 -> 1
    const [faces, setFaces] = useState<[string, string, string, string]>([
        WORDS[0], // Face 0: 1st (decentralized)
        WORDS[3], // Face 1: 4th (Private)
        WORDS[2], // Face 2: 3rd (Global)
        WORDS[1], // Face 3: 2nd (Unstoppable)
    ]);

    // Track rotation and word index with REFS to avoid recreating interval
    // Start at index 2 (Global) because 0 and 1 are already set on faces 0 and 3
    const nextWordIndexRef = useRef(2);
    const rotationCountRef = useRef(0);

    // Notify parent of current word when faces change
    useEffect(() => {
        const faceSequence = [0, 3, 2, 1];
        const frontIdx = faceSequence[rotationCount % 4];
        onWordChange?.(faces[frontIdx]);
    }, [rotationCount, faces, onWordChange]);

    useEffect(() => {
        const runCycle = () => {
            // STEP 1: Before lifting, update the BACK face with the next word
            // With rotateX(-90deg), sequence is: 0 -> 3 -> 2 -> 1 -> 0
            // Back face relative to current front is +2 in sequence
            const currentRotation = rotationCountRef.current;
            // Calculate which physical face index is at the back right now
            const faceSequence = [0, 3, 2, 1]; // Order faces appear at front
            const backIdx = faceSequence[(currentRotation + 2) % 4];

            setFaces(prev => {
                const next = [...prev] as [string, string, string, string];
                next[backIdx] = WORDS[nextWordIndexRef.current % WORDS.length];
                nextWordIndexRef.current += 1;
                return next;
            });

            // STEP 2: Lift the cube (0ms)
            setIsLifted(true);

            // STEP 3: Begin rotation (1200ms) - CSS transition handles animation
            setTimeout(() => {
                rotationCountRef.current += 1;
                setRotationCount(rotationCountRef.current);
            }, 1200);

            // STEP 4: Descend (2500ms)
            setTimeout(() => {
                setIsLifted(false);
            }, 2500);
        };

        // Initial delay then start cycling
        let interval: ReturnType<typeof setInterval> | null = null;
        const timeout = setTimeout(() => {
            runCycle();
            interval = setInterval(runCycle, 3900);
        }, 1000);

        return () => {
            clearTimeout(timeout);
            if (interval) clearInterval(interval);
        };
    }, []); // EMPTY dependency array - interval created only once

    // Calculate CSS transform
    const liftZ = isLifted ? "1.5em" : "0";
    const rotateX = rotationCount * -90; // Negative = scroll up (top comes to front)

    // Current visible face (for ghost element sizing)
    const faceSequence = [0, 3, 2, 1];
    const visibleFaceIndex = faceSequence[rotationCount % 4];
    const currentWord = faces[visibleFaceIndex];
    const iconConfig = WORD_ICONS[currentWord || ""];
    const isBrand = (currentWord || "") === "Decentralized";

    return (
        <span className="machined-scene">
            {/* Ghost element for width sizing - STACK ALL WORDS to ensure constant max width */}
            <span
                className="machined-text opacity-0 invisible pointer-events-none select-none grid grid-areas-stack"
                aria-hidden="true"
                style={{ gridTemplateAreas: '"stack"' }}
            >
                {WORDS.map((word) => {
                    const wIconConfig = WORD_ICONS[word] || {};
                    const WIcon = wIconConfig.icon;
                    const wIsBrand = word === "Decentralized";

                    return (
                        <span
                            key={word}
                            className="flex items-center gap-3 md:gap-5"
                            style={{ gridArea: "stack" }}
                        >
                            {wIconConfig.img ? (
                                <img
                                    src={wIconConfig.img}
                                    className={`w-12 h-12 md:w-20 md:h-20 flex-shrink-0 object-contain ${wIsBrand ? "scale-[1.14]" : ""}`}
                                    alt=""
                                />
                            ) : (
                                <span className="w-12 h-12 md:w-20 md:h-20 flex-shrink-0 flex items-center justify-center">
                                    {/* Render icon to ensure correct spacing/sizing */}
                                    {WIcon && <WIcon className="w-12 h-12 md:w-20 md:h-20" />}
                                </span>
                            )}
                            <span>{word}</span>
                        </span>
                    );
                })}
            </span>

            {/* The 3D cube - NO gradient on faces */}
            <span
                className="machined-cube"
                style={{
                    transform: `translateZ(${liftZ}) rotateX(${rotateX}deg)`,
                    transition: "transform 1.2s ease-in-out"
                }}
            >
                {faces.map((word, i) => {
                    const faceClasses = [
                        "machined-cube-face-front",
                        "machined-cube-face-bottom",
                        "machined-cube-face-back",
                        "machined-cube-face-top"
                    ];
                    const wordIconConfig = WORD_ICONS[word];
                    const Icon = wordIconConfig?.icon;

                    const isBrand = word === "Decentralized";

                    // VISIBILITY FIX: Solid Physics + Clean Bottom.
                    // - Front: Visible (Snaps in).
                    // - Top/Back: Hidden.
                    // - Bottom: Visible during rotation, then Snaps Out (Delayed).
                    const currentRotation = rotationCount;
                    const faceSequence = [0, 3, 2, 1];
                    const frontFaceIdx = faceSequence[currentRotation % 4];
                    const bottomFaceIdx = faceSequence[(currentRotation + 3) % 4];

                    const isVisible = (i === frontFaceIdx); // Strict: Only Front is permanent.
                    const isLeaving = (i === bottomFaceIdx);

                    return (
                        <span
                            key={i}
                            className={`machined-cube-face ${faceClasses[i]} ${isVisible ? "opacity-100" : "opacity-0"} bg-neutral-950`}
                            style={{
                                backgroundColor: "#0a0a0a",
                                // SNAP LOGIC: Instant Opacity change (0s).
                                // Delay Bottom hide by 1.1s (Matches 1.2s rotation) to allow FULL rotation, then vanish.
                                transition: "opacity 0s, background 0.2s, box-shadow 0.2s",
                                transitionDelay: isLeaving ? "1.1s" : "0s"
                            }}
                        >
                            <span className="machined-text flex flex-row items-center whitespace-nowrap gap-3 md:gap-5">
                                {wordIconConfig.img ? (
                                    <img
                                        src={wordIconConfig.img}
                                        className={`w-12 h-12 md:w-20 md:h-20 flex-shrink-0 object-contain ${isBrand ? "scale-[1.14]" : ""}`}
                                        alt=""
                                    />
                                ) : (
                                    Icon && <Icon className={`w-12 h-12 md:w-20 md:h-20 flex-shrink-0 ${wordIconConfig.color}`} aria-hidden="true" />
                                )}
                                <span className={isBrand ? "bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent" : "text-white"}>
                                    {word}
                                </span>
                            </span>
                        </span>
                    );
                })}
            </span>
        </span>
    );
}
