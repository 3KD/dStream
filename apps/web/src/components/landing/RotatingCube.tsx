"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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

export type CubeVisualMode = "disco" | "psychedelic";

interface RotatingCubeProps {
  onWordChange?: (word: string) => void;
  visualMode?: CubeVisualMode;
}

const EDGE_COUNT = 12;

const FACE_OPPOSING_EDGE_PAIRS = [
  [
    [0, 4],
    [8, 9]
  ], // front
  [
    [1, 5],
    [9, 10]
  ], // right
  [
    [2, 6],
    [10, 11]
  ], // back
  [
    [3, 7],
    [11, 8]
  ], // left
  [
    [0, 2],
    [1, 3]
  ], // top
  [
    [4, 6],
    [5, 7]
  ] // bottom
] as const;

const DISPLAY_FACE_EDGE_INDEX = [
  { top: 0, right: 9, bottom: 4, left: 8 }, // front
  { top: 4, right: 5, bottom: 6, left: 7 }, // bottom
  { top: 2, right: 10, bottom: 6, left: 11 }, // back
  { top: 0, right: 1, bottom: 2, left: 3 } // top
] as const;

const DISPLAY_FACE_VALUE_INDEX = [0, 5, 2, 4] as const;

const EDGE_NODE_POSITION = {
  top: { top: "12%", left: "50%" },
  right: { top: "50%", left: "88%" },
  bottom: { top: "88%", left: "50%" },
  left: { top: "50%", left: "12%" }
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function seededUnit(seed: number) {
  const raw = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return raw - Math.floor(raw);
}

function buildSeededEdgeValues(seed: number) {
  return Array.from({ length: EDGE_COUNT }, (_, idx) => 0.65 + seededUnit(seed + idx * 17.3) * 1.1);
}

function buildRandomEdgeValues() {
  return Array.from({ length: EDGE_COUNT }, () => 0.6 + Math.random() * 1.3);
}

function computeFaceProductValues(edgeValues: number[]) {
  return FACE_OPPOSING_EDGE_PAIRS.map((pairs) => {
    const pairA = edgeValues[pairs[0][0]] * edgeValues[pairs[0][1]];
    const pairB = edgeValues[pairs[1][0]] * edgeValues[pairs[1][1]];
    return Math.sqrt(Math.max(0.01, pairA * pairB));
  });
}

function computeAnimatedEdgeValues(baseValues: number[], rotationDegrees: number, nowMs: number, chaotic: boolean) {
  const rotationRad = (rotationDegrees * Math.PI) / 180;
  return baseValues.map((base, idx) => {
    const phase = idx * 0.63;
    const rotationWave = Math.sin(rotationRad + phase);
    const driftWave = Math.sin(nowMs * 0.0014 + phase * 1.7);
    const chaosWave = chaotic
      ? Math.sin(nowMs * 0.0041 + phase * 4.9) * 0.33 + Math.cos(nowMs * 0.0033 + phase * 2.1) * 0.18
      : 0;
    const next = base * (1 + rotationWave * 0.24 + driftWave * 0.16 + chaosWave);
    return clamp(next, 0.1, 4.5);
  });
}

function colorForValue(value: number) {
  const hue = 170 + ((value * 78) % 190);
  return `hsl(${hue}deg 92% 64%)`;
}

export function RotatingCube({ onWordChange, visualMode = "disco" }: RotatingCubeProps) {
  const [rotationCount, setRotationCount] = useState(0);
  const [isLifted, setIsLifted] = useState(false);
  const isPsychedelic = visualMode === "psychedelic";

  const [faces, setFaces] = useState<[string, string, string, string]>([
    WORDS[0],
    WORDS[3],
    WORDS[2],
    WORDS[1]
  ]);

  const nextWordIndexRef = useRef(4);
  const rotationCountRef = useRef(0);
  const [edgeBaseValues, setEdgeBaseValues] = useState<number[]>(() => buildSeededEdgeValues(42));
  const [edgeValues, setEdgeValues] = useState<number[]>(() => buildSeededEdgeValues(77));
  const [faceProductValues, setFaceProductValues] = useState<number[]>(() => computeFaceProductValues(buildSeededEdgeValues(77)));
  const [chaosEnabled, setChaosEnabled] = useState(false);

  useEffect(() => {
    const faceSequence = [0, 3, 2, 1];
    const frontIdx = faceSequence[rotationCount % 4];
    onWordChange?.(faces[frontIdx]);
  }, [rotationCount, faces, onWordChange]);

  useEffect(() => {
    if (!isPsychedelic) return;
    const tick = () => {
      const rotationDegrees = rotationCountRef.current * -90;
      const nextEdgeValues = computeAnimatedEdgeValues(edgeBaseValues, rotationDegrees, performance.now(), chaosEnabled);
      setEdgeValues(nextEdgeValues);
      setFaceProductValues(computeFaceProductValues(nextEdgeValues));
    };

    tick();
    const timer = window.setInterval(tick, 90);
    return () => window.clearInterval(timer);
  }, [isPsychedelic, edgeBaseValues, chaosEnabled]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runCycle = () => {
      if (cancelled) return;
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
        if (cancelled) return;
        rotationCountRef.current += 1;
        setRotationCount(rotationCountRef.current);
      }, 1200);

      setTimeout(() => {
        if (cancelled) return;
        setIsLifted(false);
      }, 2500);

      // Schedule next cycle after this one completes (total cycle = 3900ms).
      timer = setTimeout(runCycle, 3900);
    };

    // First rotation after 1s pause to let the initial word be visible.
    timer = setTimeout(runCycle, 1000);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const liftZ = isLifted ? "1.5em" : "0";
  const rotateX = rotationCount * -90;

  const faceSequence = [0, 3, 2, 1];
  const handlePsychedelicClick = () => {
    if (!isPsychedelic) return;
    const nextChaos = !chaosEnabled;
    const nextBase = buildRandomEdgeValues();
    const nextEdgeValues = computeAnimatedEdgeValues(nextBase, rotationCountRef.current * -90, performance.now(), nextChaos);
    setChaosEnabled(nextChaos);
    setEdgeBaseValues(nextBase);
    setEdgeValues(nextEdgeValues);
    setFaceProductValues(computeFaceProductValues(nextEdgeValues));
  };

  const handleSceneKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!isPsychedelic) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handlePsychedelicClick();
  };

  return (
    <span
      className={`machined-scene${isPsychedelic ? " cursor-pointer select-none" : ""}`}
      onClick={handlePsychedelicClick}
      onKeyDown={handleSceneKeyDown}
      role={isPsychedelic ? "button" : undefined}
      tabIndex={isPsychedelic ? 0 : undefined}
      aria-label={isPsychedelic ? "Toggle psychedelic random oscillation and reseed edge values" : undefined}
    >
      {isPsychedelic && (
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 rounded-full border border-cyan-400/40 bg-neutral-950/80 px-2 py-0.5 text-[10px] uppercase tracking-wide text-cyan-100">
          {chaosEnabled ? "psychedelic: random oscillation on" : "psychedelic: smooth oscillation"}
        </span>
      )}
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
          const faceProductValue = faceProductValues[DISPLAY_FACE_VALUE_INDEX[i]] ?? 1;
          const faceEdges = DISPLAY_FACE_EDGE_INDEX[i];
          const faceBackground = isPsychedelic
            ? "radial-gradient(circle at 50% 40%, rgba(56,189,248,0.25), rgba(124,58,237,0.30) 45%, rgba(10,10,10,0.98) 100%)"
            : "#0a0a0a";

          return (
            <span
              key={i}
              className={`machined-cube-face ${faceClasses[i]} ${isVisible ? "opacity-100" : "opacity-0"} bg-neutral-950 relative overflow-hidden`}
              style={{
                background: faceBackground,
                transition: "opacity 0s, background 0.2s, box-shadow 0.2s",
                transitionDelay: isLeaving ? "1.1s" : "0s"
              }}
            >
              {isPsychedelic && (
                <span className="absolute inset-0 pointer-events-none">
                  <span className="absolute inset-[8%] rounded-[10px] border border-cyan-300/20" />
                  {(["top", "right", "bottom", "left"] as const).map((edgePos) => {
                    const edgeIndex = faceEdges[edgePos];
                    const value = edgeValues[edgeIndex] ?? 1;
                    const color = colorForValue(value);
                    const pos = EDGE_NODE_POSITION[edgePos];
                    return (
                      <span
                        key={`${i}-${edgePos}`}
                        className="absolute -translate-x-1/2 -translate-y-1/2"
                        style={{ top: pos.top, left: pos.left }}
                      >
                        <span
                          className="block h-2.5 w-2.5 rounded-full border border-white/60"
                          style={{ backgroundColor: color, boxShadow: `0 0 12px ${color}` }}
                        />
                        <span className="absolute top-[120%] left-1/2 -translate-x-1/2 text-[9px] font-mono tracking-tight text-cyan-100/90">
                          {value.toFixed(2)}
                        </span>
                      </span>
                    );
                  })}
                  <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                    <span
                      className="flex min-w-12 items-center justify-center rounded-full border border-fuchsia-300/70 px-1.5 py-0.5 text-[10px] font-mono text-white/95"
                      style={{
                        backgroundColor: "rgba(124,58,237,0.42)",
                        boxShadow: `0 0 14px ${colorForValue(faceProductValue)}`
                      }}
                    >
                      {faceProductValue.toFixed(2)}
                    </span>
                  </span>
                </span>
              )}
              <span className="machined-text relative z-10 flex flex-row items-center whitespace-nowrap gap-3 md:gap-5">
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
