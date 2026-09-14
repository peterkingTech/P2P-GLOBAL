"use client";

import { useEffect, useRef, useState } from "react";
import { DemoPhoto } from "@/components/media/DemoPhoto";

const STAGES = ["LEARN", "GROW", "HELP", "MULTIPLY"] as const;
const STAGE_COPY: Record<(typeof STAGES)[number], string> = {
  LEARN: "Scripture, discipleship, wisdom — learning from someone a step ahead.",
  GROW: "Character, faith, obedience — spiritual maturity that shows.",
  HELP: "Encourage, walk with others, share what you've learned.",
  MULTIPLY: "Disciple others. Teach others. Serve others. Begin again.",
};
const STAGE_MEDIA: Record<(typeof STAGES)[number], string> = {
  LEARN: "P2P_LEARN_001",
  GROW: "P2P_GROW_001",
  HELP: "P2P_HELP_001",
  MULTIPLY: "P2P_MULTIPLY_001",
};

export function FlowRibbon() {
  const sectionRef = useRef<HTMLElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    const path = pathRef.current;
    if (!section || !path) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = reduceMotion ? "0" : `${length}`;

    if (reduceMotion) {
      setActive(3);
      return;
    }

    let cleanup = () => {};

    (async () => {
      const gsapModule = await import("gsap");
      const stModule = await import("gsap/ScrollTrigger");
      const gsap = gsapModule.default;
      const ScrollTrigger = stModule.ScrollTrigger;
      gsap.registerPlugin(ScrollTrigger);

      const isSmall = window.innerWidth < 760;

      const applyProgress = (progress: number) => {
        path.style.strokeDashoffset = `${length * (1 - progress)}`;
        setActive(Math.min(3, Math.floor(progress * 4)));
      };

      const trigger = ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: isSmall ? "+=60%" : "+=180%",
        pin: !isSmall,
        scrub: isSmall ? false : 0.6,
        onRefresh: (self) => applyProgress(self.progress),
        onUpdate: (self) => applyProgress(self.progress),
        onToggle: (self) => {
          if (isSmall && self.isActive) {
            gsap.to(path, { strokeDashoffset: 0, duration: 1.2, ease: "power2.out" });
            setActive(3);
          }
        },
      });

      // Seed from the trigger's own initial progress — see the identical
      // note in MultiplicationTree.tsx: a scroll that lands mid-scene
      // won't fire onUpdate on its own.
      if (!isSmall) applyProgress(trigger.progress);

      cleanup = () => trigger.kill();
    })();

    return () => cleanup();
  }, []);

  return (
    <section ref={sectionRef} className="ribbon-pin" aria-labelledby="scene04-heading">
      <div className="scene-content">
        <p className="eyebrow">Learn · Grow · Help · Multiply</p>
        <h2 id="scene04-heading" className="visually-hidden">
          Learn, grow, help, multiply
        </h2>
        <div className="diagram-box" style={{ maxWidth: 460, margin: "0 auto" }}>
          <svg viewBox="0 0 300 225" role="img" aria-label="Learn, grow, help, multiply — a continuous cycle">
            <path
              ref={pathRef}
              d="M20,180 C90,60 120,190 150,110 C180,30 210,170 280,50"
              fill="none"
              stroke="#e0b45f"
              strokeWidth="2"
            />
            <path
              d="M20,180 C90,60 120,190 150,110 C180,30 210,170 280,50"
              fill="none"
              stroke="#c9d6d0"
              strokeOpacity="0.25"
              strokeWidth="1"
            />
          </svg>
        </div>
        <div className="ribbon-stages">
          {STAGES.map((s, i) => (
            <div key={s} className={`ribbon-stage${i <= active ? " lit" : ""}`}>
              <DemoPhoto id={STAGE_MEDIA[s]} className="ribbon-stage-photo" />
              <span className="rs-word serif">{s}</span>
              <p>{STAGE_COPY[s]}</p>
            </div>
          ))}
        </div>
        <a href="/how-it-works" className="btn btn-ghost">
          See how it works →
        </a>
      </div>
    </section>
  );
}
