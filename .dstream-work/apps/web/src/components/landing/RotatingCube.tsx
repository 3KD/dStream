"use client";

import { useEffect, useState, useRef } from "react";
import {
  ShieldCheck,
  Unlock,
  Users,
  EyeOff,
  Network,
  Globe,
  PenTool,
  Megaphone,
  Music,
  Camera,
  Gamepad,
  Flag,
  type LucideIcon
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

const WORD_ICONS: Record<string, { icon?: LucideIcon; img?: string; color: string }> = {
  Decentralized: { img: "/logo_trimmed.png", color: "text-purple-400" },
  Unstoppable: { icon: ShieldCheck, color: "text-green-400" },
  Permissionless: { icon: Unlock, color: "text-yellow-400" },
  Ownerless: { icon: Users, color: "text-blue-400" },
  Private: { icon: EyeOff, color: "text-red-400" },
  P2P: { icon: Network, color: "text-cyan-400" },
  Global: { icon: Globe, color: "text-emerald-400" },
  Journalism: { icon: PenTool, color: "text-orange-400" },
  Activism: { icon: Megaphone, color: "text-pink-400" },
  Music: { icon: Music, color: "text-violet-400" },
  Influencer: { icon: Camera, color: "text-rose-400" },
  Gamer: { icon: Gamepad, color: "text-lime-400" },
  Independent: { icon: Flag, color: "text-amber-400" }
};

export const WORD_COLORS_HEX: Record<string, string> = {
  Decentralized: "#ffffff",
  Unstoppable: "#4ade80",
  Permissionless: "#facc15",
  Ownerless: "#60a5fa",
  Private: "#f87171",
  P2P: "#22d3ee",
  Global: "#34d399",
  Journalism: "#fb923c",
  Activism: "#f472b6",
  Music: "#a78bfa",
  Influencer: "#fb7185",
  Gamer: "#a3e635",
  Independent: "#fbbf24"
};

interface RotatingCubeProps {
  onWordChange?: (word: string) => void;
}

export function RotatingCube({ onWordChange }: RotatingCubeProps) {
  const [rotationCount, setRotationCount] = useState(0);
  const [isLifted, setIsLifted] = useState(false);

  const [faces, setFaces] = useState<[string, string, string, string]>([
    WORDS[0],
    WORDS[3],
    WORDS[2],
    WORDS[1]
  ]);

  const nextWordIndexRef = useRef(2);
  const rotationCountRef = useRef(0);

  useEffect(() => {
    const faceSequence = [0, 3, 2, 1];
    const frontIdx = faceSequence[rotationCount % 4];
    onWordChange?.(faces[frontIdx]);
  }, [rotationCount, faces, onWordChange]);

  useEffect(() => {
    const runCycle = () => {
      const currentRotation = rotationCountRef.current;
      const faceSequence = [0, 3, 2, 1];
      const backIdx = faceSequence[(currentRotation + 2) % 4];

      setFaces((prev) => {
        const next = [...prev] as [string, string, string, string];
        next[backIdx] = WORDS[nextWordIndexRef.current % WORDS.length];
        nextWordIndexRef.current += 1;
        return next;
      });

      setIsLifted(true);

      setTimeout(() => {
        rotationCountRef.current += 1;
        setRotationCount(rotationCountRef.current);
      }, 1200);

      setTimeout(() => {
        setIsLifted(false);
      }, 2500);
    };

    const timeout = setTimeout(runCycle, 1000);
    const interval = setInterval(runCycle, 3900);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  const liftZ = isLifted ? "1.5em" : "0";
  const rotateX = rotationCount * -90;

  const faceSequence = [0, 3, 2, 1];

  return (
    <span className="machined-scene">
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
            <span key={word} className="flex items-center gap-3 md:gap-5" style={{ gridArea: "stack" }}>
              {wIconConfig.img ? (
                <img
                  src={wIconConfig.img}
                  className={`w-12 h-12 md:w-20 md:h-20 flex-shrink-0 object-contain ${wIsBrand ? "scale-[1.14]" : ""}`}
                  alt=""
                />
              ) : (
                <span className="w-12 h-12 md:w-20 md:h-20 flex-shrink-0 flex items-center justify-center">
                  {WIcon && <WIcon className="w-12 h-12 md:w-20 md:h-20" />}
                </span>
              )}
              <span>{word}</span>
            </span>
          );
        })}
      </span>

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
          const isBrandWord = word === "Decentralized";

          const isVisible = i === faceSequence[rotationCount % 4];
          const isLeaving = i === faceSequence[(rotationCount + 3) % 4];

          return (
            <span
              key={i}
              className={`machined-cube-face ${faceClasses[i]} ${isVisible ? "opacity-100" : "opacity-0"} bg-neutral-950`}
              style={{
                backgroundColor: "#0a0a0a",
                transition: "opacity 0s, background 0.2s, box-shadow 0.2s",
                transitionDelay: isLeaving ? "1.1s" : "0s"
              }}
            >
              <span className="machined-text flex flex-row items-center whitespace-nowrap gap-3 md:gap-5">
                {wordIconConfig?.img ? (
                  <img
                    src={wordIconConfig.img}
                    className={`w-12 h-12 md:w-20 md:h-20 flex-shrink-0 object-contain ${isBrandWord ? "scale-[1.14]" : ""}`}
                    alt=""
                  />
                ) : (
                  Icon && (
                    <Icon
                      className={`w-12 h-12 md:w-20 md:h-20 flex-shrink-0 ${wordIconConfig?.color ?? ""}`}
                      aria-hidden="true"
                    />
                  )
                )}
                <span className={isBrandWord ? "bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent" : "text-white"}>
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
