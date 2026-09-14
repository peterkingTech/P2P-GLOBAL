"use client";

import { useEffect, useRef } from "react";

export type Distribution = "ambient" | "constellation" | "cluster" | "sphere" | "mesh";

type Point = {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  r: number;
  o: number;
  color: string;
};

const FOREST = "29, 158, 117";
const EMBER = "224, 180, 95";
const SILVER = "201, 214, 208";

function seedRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function buildPoints(distribution: Distribution, w: number, h: number, density: number): Point[] {
  const rand = seedRandom(42);
  const pts: Point[] = [];
  const ambientCount = Math.round(90 * density);

  for (let i = 0; i < ambientCount; i++) {
    const x = rand() * w;
    const y = rand() * h;
    pts.push({ x, y, baseX: x, baseY: y, r: 0.6 + rand() * 1.2, o: 0.15 + rand() * 0.35, color: SILVER });
  }

  if (distribution === "constellation") {
    const cx1 = w * 0.44;
    const cx2 = w * 0.56;
    const cy = h * 0.5;
    pts.push({ x: cx1, y: cy, baseX: cx1, baseY: cy, r: 5, o: 0.9, color: EMBER });
    pts.push({ x: cx2, y: cy, baseX: cx2, baseY: cy, r: 5, o: 0.9, color: FOREST });
  }

  if (distribution === "cluster") {
    const clusters = Math.max(2, Math.round(4 * density));
    for (let c = 0; c < clusters; c++) {
      const cx = w * (0.25 + 0.5 * rand());
      const cy = h * (0.35 + 0.35 * rand());
      const n = 5 + Math.round(rand() * 5);
      for (let i = 0; i < n; i++) {
        const x = cx + (rand() - 0.5) * 60;
        const y = cy + (rand() - 0.5) * 60;
        pts.push({
          x,
          y,
          baseX: x,
          baseY: y,
          r: 2.4 + rand() * 2,
          o: 0.5 + rand() * 0.4,
          color: rand() > 0.5 ? EMBER : FOREST,
        });
      }
    }
  }

  if (distribution === "sphere") {
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.32;
    const n = Math.round(140 * density);
    for (let i = 0; i < n; i++) {
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const x = cx + radius * Math.sin(phi) * Math.cos(theta);
      const y = cy + radius * 0.62 * Math.sin(phi) * Math.sin(theta) * 0.9 + radius * 0.0;
      const depth = Math.cos(theta);
      pts.push({
        x,
        y,
        baseX: x,
        baseY: y,
        r: 1 + depth * 0.6,
        o: 0.25 + Math.max(0, depth) * 0.4,
        color: rand() > 0.85 ? EMBER : SILVER,
      });
    }
  }

  if (distribution === "mesh") {
    const n = Math.round(9 * density);
    for (let i = 0; i < n; i++) {
      const x = w * (0.15 + 0.7 * rand());
      const y = h * (0.2 + 0.6 * rand());
      pts.push({ x, y, baseX: x, baseY: y, r: 3, o: 0.85, color: EMBER });
    }
  }

  return pts;
}

export function ParticleField({
  distribution,
  className,
  rotate = false,
}: {
  distribution: Distribution;
  className?: string;
  rotate?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isSmall = window.innerWidth < 760;
    const density = isSmall ? 0.35 : 1;

    let width = 0;
    let height = 0;
    let points: Point[] = [];
    let raf = 0;
    let angle = 0;
    // Two independent gates: the tab must be foregrounded AND this scene's
    // canvas must actually be near the viewport. Without the second gate,
    // every ParticleField on the page — including ones far below the fold
    // nobody has scrolled to yet — runs its animation loop from first
    // paint, which is what turned into ~7s of blocked main-thread time on
    // the homepage (6+ simultaneous canvases, each doing per-point trig
    // every frame) before this fix.
    let tabVisible = true;
    let inViewport = false;

    function resize() {
      if (!canvas) return;
      const rect = canvas.parentElement?.getBoundingClientRect();
      width = rect?.width ?? window.innerWidth;
      height = rect?.height ?? window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      points = buildPoints(distribution, width, height, density);
    }

    function drawMeshLines() {
      if (distribution !== "mesh") return;
      ctx!.strokeStyle = `rgba(${SILVER}, 0.18)`;
      ctx!.lineWidth = 0.6;
      const nodes = points.filter((p) => p.r >= 2.5);
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          if (Math.sqrt(dx * dx + dy * dy) < Math.max(width, height) * 0.35) {
            ctx!.beginPath();
            ctx!.moveTo(nodes[i].x, nodes[i].y);
            ctx!.lineTo(nodes[j].x, nodes[j].y);
            ctx!.stroke();
          }
        }
      }
    }

    function shouldAnimate() {
      return tabVisible && inViewport && !reduceMotion;
    }

    function frame(t: number) {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      drawMeshLines();

      const cx = width / 2;
      const rot = rotate ? angle : 0;

      for (const p of points) {
        let x = p.baseX;
        let y = p.baseY;

        if (!reduceMotion) {
          x += Math.sin(t / 4000 + p.baseX) * 3;
          y += Math.cos(t / 4500 + p.baseY) * 3;
        }

        if (rotate && distribution === "sphere") {
          const dx = p.baseX - cx;
          const rx = dx * Math.cos(rot);
          x = cx + rx;
        }

        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, ${p.o})`;
        ctx.fill();
      }

      if (shouldAnimate()) {
        angle += 0.0016;
        raf = requestAnimationFrame(frame);
      }
    }

    function startIfNeeded() {
      if (shouldAnimate() && !raf) raf = requestAnimationFrame(frame);
    }

    function stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    }

    resize();
    frame(0);

    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const io = new IntersectionObserver(
      (entries) => {
        inViewport = entries[0]?.isIntersecting ?? false;
        if (shouldAnimate()) startIfNeeded();
        else stop();
      },
      { rootMargin: "200px 0px" }
    );
    if (canvas.parentElement) io.observe(canvas.parentElement);

    function onVisibility() {
      tabVisible = !document.hidden;
      if (shouldAnimate()) startIfNeeded();
      else stop();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [distribution, rotate]);

  return (
    <div className={`scene-canvas${className ? ` ${className}` : ""}`} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
