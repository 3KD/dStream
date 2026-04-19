"use client";
import { usePathname } from "next/navigation";
import { SiteFooter } from "./SiteFooter";

export function SiteFooterWrapper() {
  const pathname = usePathname();
  if (pathname?.startsWith("/watch")) return null;
  return <SiteFooter />;
}
