"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/why-p2p", label: "Why P2P" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/experience", label: "Experience" },
  { href: "/explore", label: "Explore" },
  { href: "/about", label: "About" },
];

export function SiteNav() {
  const pathname = usePathname();
  // The transparent-over-hero treatment only reads correctly when the page
  // opens on the dark cinematic hero (the homepage). Every inner page starts
  // solid immediately — some open on a light Parchment hero (e.g.
  // /explore/stories), where light nav text over a transparent bar is
  // unreadable against a light ground.
  const isHomepage = pathname === "/";
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const solid = !isHomepage || scrolled || open;

  useEffect(() => {
    if (!isHomepage) return;
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isHomepage]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <header className={`site-nav${solid ? " solid" : ""}`}>
        <Link href="/" className="wordmark">
          P2P Global
        </Link>
        <nav className="links" aria-label="Primary">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
          <Link href="/get-the-app" className="app">
            Get the App
          </Link>
        </nav>
        <button
          className="nav-burger"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-nav-drawer"
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </header>
      {open && (
        <nav id="mobile-nav-drawer" className="nav-drawer" aria-label="Mobile">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          <Link href="/get-the-app" className="app" onClick={() => setOpen(false)}>
            Get the App
          </Link>
        </nav>
      )}
    </>
  );
}
