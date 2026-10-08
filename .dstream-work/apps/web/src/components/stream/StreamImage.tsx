"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

interface StreamImageProps {
  src: string;
  alt: string;
  className?: string;
  sizes: string;
  onError?: () => void;
}

export function StreamImage({ src, alt, className, sizes, onError }: StreamImageProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    setFailedSource(null);
    setLoadedSource(null);
    setNearViewport(false);
  }, [src]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: "400px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [src]);

  useEffect(() => {
    if (!nearViewport || loadedSource === src || failedSource === src) return;
    const timeout = window.setTimeout(() => {
      setFailedSource(src);
      onErrorRef.current?.();
    }, 12_000);
    return () => window.clearTimeout(timeout);
  }, [failedSource, loadedSource, nearViewport, src]);

  return (
    <span ref={containerRef} className="relative block h-full w-full overflow-hidden bg-neutral-900">
      <span
        aria-hidden="true"
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-neutral-900"
      >
        <Image src="/logo_trimmed.png" alt="" width={56} height={56} className="h-14 w-14 object-contain opacity-15 grayscale" />
        <span className="text-[11px] font-semibold text-neutral-700">dStream</span>
      </span>
      {failedSource !== src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          unoptimized
          className={`${className ?? ""} transition-opacity duration-150 ${loadedSource === src ? "opacity-100" : "opacity-0"}`}
          loading="lazy"
          onLoad={() => setLoadedSource(src)}
          onError={() => {
            setFailedSource(src);
            onErrorRef.current?.();
          }}
        />
      ) : null}
    </span>
  );
}
