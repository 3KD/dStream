"use client";

import { useEffect, useState, useRef, useCallback } from "react";
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
  Independent: { icon: Flag, color: "text-amber-400" },
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
  Independent: "#fbbf24",
};

// ── Timing ──────────────────────────────────────────────
// One full cycle: HOLD → LIFT → ROTATE → DROP → repeat
const HOLD_MS   = 1400;  // word sits visible, flat
const LIFT_MS   = 600;   // cube rises
const ROTATE_MS = 800;   // cube spins 90°
const DROP_MS   = 600;   // cube settles back down
const CYCLE_MS  = HOLD_MS + LIFT_MS + ROTATE_MS + DROP_MS; // total per word

// CSS transition adapts to whichever phase is active
type Phase = "hold" | "lift" | "rotate" | "drop";

function transitionFor(phase: Phase): string {
  switch (phase) {
    case "hold":   return "transform 0ms linear";
    case "lift":   return `transform ${LIFT_MS}ms ease-out`;
    case "rotate": return `transform ${ROTATE_MS}ms ease-in-out`;
    case "drop":   return `transform ${DROP_MS}ms ease-in`;
  }
}

// ── Face helpers ────────────────────────────────────────
// Physical face indices cycle through view in this order:
const FACE_SEQ = [0, 3, 2, 1] as const;

interface RotatingCubeProps {
  onWordChange?: (word: string) => void;
}

export function RotatingCube({ onWordChange }: RotatingCubeProps) {
  const [rotation, setRotation] = useState(0);       // increments by 1 each spin
  const [phase, setPhase] = useState<Phase>("hold");  // current animation phase
  const [faces, setFaces] = useState<[string, string, string, string]>([
    WORDS[0], WORDS[3], WORDS[2], WORDS[1]
  ]);

  const rotRef = useRef(0);
  const wordIdx = useRef(4); // next word to load (0-3 already placed)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const schedule = useCallback((fn: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (mounted.current) fn(); }, ms);
  }, []);

  // Notify parent whenever the visible word changes
  useEffect(() => {
    const frontIdx = FACE_SEQ[rotation % 4];
    onWordChange?.(faces[frontIdx]);
  }, [rotation, faces, onWordChange]);

  // The state machine
  useEffect(() => {
    mounted.current = true;

    const doHold = () => {
      setPhase("hold");
      schedule(doLift, HOLD_MS);
    };

    const doLift = () => {
      // Load next word onto the back face BEFORE lifting
      const r = rotRef.current;
      const backIdx = FACE_SEQ[(r + 2) % 4];
      setFaces(prev => {
        const next = [...prev] as [string, string, string, string];
        next[backIdx] = WORDS[wordIdx.current % WORDS.length];
        wordIdx.current += 1;
        return next;
      });
      setPhase("lift");
      schedule(doRotate, LIFT_MS);
    };

    const doRotate = () => {
      rotRef.current += 1;
      setRotation(rotRef.current);
      setPhase("rotate");
      schedule(doDrop, ROTATE_MS);
    };

    const doDrop = () => {
      setPhase("drop");
      schedule(doHold, DROP_MS);
    };

    // Start: show first word for a beat, then begin
    schedule(doLift, HOLD_MS + 600);

    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Transform ───────────────────────────────────────
  const lifted = phase === "lift" || phase === "rotate";
  const liftZ = lifted ? "1.5em" : "0";
  const rotateX = rotation * -90;

  return (
    <span className="machined-scene">
      {/* Ghost sizer — stacks all words invisibly for stable width */}
      <span
        className="machined-text opacity-0 invisible pointer-events-none select-none grid"
        aria-hidden="true"
        style={{ gridTemplateAreas: '"stack"' }}
      >
        {WORDS.map((word) => {
          const cfg = WORD_ICONS[word] || {};
          const WIcon = cfg.icon;
          const brand = word === "Decentralized";
          return (
            <span key={word} className="flex items-center gap-3 md:gap-5" style={{ gridArea: "stack" }}>
              {cfg.img ? (
                <img src={cfg.img} className={`w-12 h-12 md:w-20 md:h-20 flex-shrink-0 object-contain ${brand ? "scale-[1.14]" : ""}`} alt="" />
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

      {/* The 3D cube */}
      <span
        className="machined-cube"
        style={{
          transform: `translateZ(${liftZ}) rotateX(${rotateX}deg)`,
          transition: transitionFor(phase)
        }}
      >
        {faces.map((word, i) => {
          const cls = ["machined-cube-face-front", "machined-cube-face-bottom", "machined-cube-face-back", "machined-cube-face-top"][i];
          const cfg = WORD_ICONS[word];
          const Icon = cfg?.icon;
          const brand = word === "Decentralized";
          const isFront = i === FACE_SEQ[rotation % 4];
          const isLeaving = i === FACE_SEQ[(rotation + 3) % 4];

          return (
            <span
              key={i}
              className={`machined-cube-face ${cls} ${isFront ? "opacity-100" : "opacity-0"} bg-neutral-950`}
              style={{
                backgroundColor: "#0a0a0a",
                transition: "opacity 0s, background 0.2s, box-shadow 0.2s",
                transitionDelay: isLeaving ? `${ROTATE_MS - 100}ms` : "0s"
              }}
            >
              <span className="machined-text flex flex-row items-center whitespace-nowrap gap-3 md:gap-5">
                {cfg?.img ? (
                  <img src={cfg.img} className={`w-12 h-12 md:w-20 md:h-20 flex-shrink-0 object-contain ${brand ? "scale-[1.14]" : ""}`} alt="" />
                ) : (
                  Icon && <Icon className={`w-12 h-12 md:w-20 md:h-20 flex-shrink-0 ${cfg?.color ?? ""}`} aria-hidden="true" />
                )}
                <span className={brand ? "bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent" : "text-white"}>
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
