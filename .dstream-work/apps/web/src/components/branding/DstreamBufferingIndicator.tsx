"use client";

interface DstreamBufferingIndicatorProps {
  label?: string | null;
  compact?: boolean;
  spinning?: boolean;
  className?: string;
}

const DOT_COUNT = 8;

export function DstreamBufferingIndicator({
  label = "Loading stream…",
  compact = false,
  spinning = true,
  className = ""
}: DstreamBufferingIndicatorProps) {
  const sizeClass = compact ? "h-14 w-14" : "h-20 w-20";
  const logoSizeClass = compact ? "h-8 w-8" : "h-10 w-10";
  const dotSizeClass = compact ? "h-1.5 w-1.5" : "h-2 w-2";
  const orbitDistance = compact ? 21 : 30;

  return (
    <div className={`flex flex-col items-center justify-center gap-2 text-center ${className}`}>
      <div className={`relative ${sizeClass}`} aria-hidden="true">
        <div className="absolute inset-0 rounded-full border border-neutral-600/40" />
        <div className={`absolute inset-0 ${spinning ? "animate-[spin_2.3s_linear_infinite]" : ""}`}>
          {Array.from({ length: DOT_COUNT }).map((_, index) => {
            const angle = (360 / DOT_COUNT) * index;
            return (
              <span
                key={index}
                className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-300/85 ${dotSizeClass}`}
                style={{ transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-${orbitDistance}px)` }}
              />
            );
          })}
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <img src="/logo_trimmed.png" alt="" className={`${logoSizeClass} object-contain grayscale opacity-70`} />
        </div>
      </div>
      {label ? <div className="text-xs text-neutral-300">{label}</div> : null}
    </div>
  );
}
