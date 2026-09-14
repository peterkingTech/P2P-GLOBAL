"use client";

import { useEffect, useRef, useState } from "react";
import { DemoPhoto } from "@/components/media/DemoPhoto";

const WORDS = ["one", "two", "four", "many", "generations", "nations"];

export function MultiplicationTree() {
  const sectionRef = useRef<HTMLElement>(null);
  const groupRefs = useRef<(SVGGElement | null)[]>([]);
  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const groups = groupRefs.current.filter(Boolean) as SVGGElement[];

    if (reduceMotion) {
      groups.forEach((g) => (g.style.opacity = "1"));
      setWordIndex(WORDS.length - 1);
      return;
    }

    groups.forEach((g) => (g.style.opacity = "0"));
    let cleanup = () => {};

    (async () => {
      const gsapModule = await import("gsap");
      const stModule = await import("gsap/ScrollTrigger");
      const gsap = gsapModule.default;
      const ScrollTrigger = stModule.ScrollTrigger;
      gsap.registerPlugin(ScrollTrigger);

      const isSmall = window.innerWidth < 760;

      if (isSmall) {
        const trigger = ScrollTrigger.create({
          trigger: section,
          start: "top 70%",
          once: true,
          onEnter: () => {
            gsap.to(groups, { opacity: 1, stagger: 0.15, duration: 0.6, ease: "power2.out" });
            setWordIndex(WORDS.length - 1);
          },
        });
        cleanup = () => trigger.kill();
        return;
      }

      const applyProgress = (progress: number) => {
        const step = Math.min(groups.length - 1, Math.floor(progress * groups.length));
        groups.forEach((g, i) => (g.style.opacity = i <= step ? "1" : "0"));
        setWordIndex(Math.min(WORDS.length - 1, Math.floor(progress * WORDS.length)));
      };

      const trigger = ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "+=160%",
        pin: true,
        scrub: 0.6,
        onRefresh: (self) => applyProgress(self.progress),
        onUpdate: (self) => applyProgress(self.progress),
      });

      // A scroll that lands mid-scene (deep link, hash jump, a test driver
      // that scrolls in one step) may not fire onUpdate on its own —
      // GSAP only calls it in response to a scroll delta after creation.
      // Seed the visible state from the trigger's own computed progress
      // so the scene never renders blank at its pre-animation default.
      applyProgress(trigger.progress);

      cleanup = () => trigger.kill();
    })();

    return () => cleanup();
  }, []);

  return (
    <section ref={sectionRef} className="ribbon-pin" aria-labelledby="scene13-heading">
      <div className="scene-content" style={{ textAlign: "center" }}>
        <p className="eyebrow">2 Timothy 2:2 · Multiplication</p>
        <h2 id="scene13-heading" className="visually-hidden">
          One disciple multiplying into many, across generations
        </h2>
        <p className="chip-row" style={{ justifyContent: "center", display: "flex" }}>
          {["Paul", "Timothy", "Faithful people", "Others"].map((name, i, arr) => (
            <span key={name} style={{ display: "inline-flex", alignItems: "center" }}>
              <span className="chip">{name}</span>
              {i < arr.length - 1 && <span style={{ margin: "0 6px", color: "var(--silver-dim)" }}>↓</span>}
            </span>
          ))}
        </p>
        <div style={{ maxWidth: 220, margin: "0 auto 20px" }}>
          <DemoPhoto id="P2P_HELP_001" />
        </div>
        <div className="diagram-box" style={{ margin: "0 auto 28px", maxWidth: 360 }}>
          <svg viewBox="0 0 300 225" role="img" aria-label="One disciple multiplying into many, across generations">
            <g ref={(el) => { groupRefs.current[0] = el; }} style={{ transition: "opacity .4s" }}>
              <circle cx="150" cy="200" r="5" fill="#e0b45f" />
            </g>
            <g ref={(el) => { groupRefs.current[1] = el; }} style={{ transition: "opacity .4s" }}>
              <line x1="150" y1="200" x2="150" y2="160" stroke="#3a5049" strokeWidth="1" />
              <line x1="150" y1="160" x2="110" y2="120" stroke="#3a5049" strokeWidth="1" />
              <line x1="150" y1="160" x2="190" y2="120" stroke="#3a5049" strokeWidth="1" />
              <circle cx="110" cy="120" r="3.4" fill="#e0b45f" />
              <circle cx="190" cy="120" r="3.4" fill="#e0b45f" />
            </g>
            <g ref={(el) => { groupRefs.current[2] = el; }} style={{ transition: "opacity .4s" }}>
              <line x1="110" y1="120" x2="85" y2="85" stroke="#3a5049" strokeWidth="1" />
              <line x1="110" y1="120" x2="135" y2="85" stroke="#3a5049" strokeWidth="1" />
              <line x1="190" y1="120" x2="165" y2="85" stroke="#3a5049" strokeWidth="1" />
              <line x1="190" y1="120" x2="215" y2="85" stroke="#3a5049" strokeWidth="1" />
              <circle cx="85" cy="85" r="2.4" fill="#e0b45f" />
              <circle cx="135" cy="85" r="2.4" fill="#e0b45f" />
              <circle cx="165" cy="85" r="2.4" fill="#e0b45f" />
              <circle cx="215" cy="85" r="2.4" fill="#e0b45f" />
            </g>
            <g ref={(el) => { groupRefs.current[3] = el; }} style={{ transition: "opacity .4s" }} fill="#c9d6d0" opacity="0.7">
              <circle cx="60" cy="50" r="1.4" />
              <circle cx="100" cy="35" r="1.2" />
              <circle cx="150" cy="30" r="1.4" />
              <circle cx="200" cy="35" r="1.2" />
              <circle cx="240" cy="50" r="1.4" />
              <circle cx="45" cy="90" r="1.2" />
              <circle cx="255" cy="90" r="1.2" />
            </g>
          </svg>
        </div>
        <p className="serif" style={{ fontStyle: "italic", fontSize: 24, color: "var(--ember-bright)" }}>
          {WORDS[wordIndex]}
        </p>
        <p className="serif" style={{ fontStyle: "italic", fontSize: 15, color: "var(--mist-dim)", maxWidth: 480, margin: "10px auto 0" }}>
          &ldquo;…what you have heard from me… entrust to faithful men, who will be able to teach others also.&rdquo;
          <br />
          <span style={{ fontStyle: "normal", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ember-bright)" }}>
            2 Timothy 2:2
          </span>
        </p>
      </div>
    </section>
  );
}
