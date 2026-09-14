"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Fade-through-Deep-Water page transition (Stage 4 System 07's universal
 * fallback, implemented as the primary mechanism — Next.js App Router
 * doesn't yet expose a stable hook into the browser View Transitions API
 * for its own navigation swap, so a same-timing overlay achieves the same
 * "water" beat without depending on an experimental API).
 *
 * On every pathname change: a Deep Water overlay fades in over the
 * (already-swapped) new page, then fades back out — 220ms out, 260ms in,
 * per the creative direction spec. Skipped entirely under
 * prefers-reduced-motion, where navigation is an instant cut.
 */
export function PageTransition() {
  const pathname = usePathname();
  const prevPathname = useRef(pathname);
  const [phase, setPhase] = useState<"idle" | "in" | "out">("idle");

  useEffect(() => {
    if (prevPathname.current === pathname) return;
    prevPathname.current = pathname;

    // Focus the new page's h1 immediately — this is never gated on the
    // animation below, decorative or not.
    const h1 = document.querySelector("h1");
    if (h1) {
      if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
      h1.focus({ preventScroll: true });
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    setPhase("in");
    const toOut = setTimeout(() => setPhase("out"), 220);
    const toIdle = setTimeout(() => setPhase("idle"), 220 + 260);
    return () => {
      clearTimeout(toOut);
      clearTimeout(toIdle);
    };
  }, [pathname]);

  if (phase === "idle") return null;

  return (
    <div
      aria-hidden="true"
      className={`page-transition-overlay ${phase === "in" ? "pt-in" : "pt-out"}`}
    />
  );
}
