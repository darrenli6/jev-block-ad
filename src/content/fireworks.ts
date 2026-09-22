/**
 * Fireworks effect: colourful sparks burst outward from the element's centre,
 * arc under gravity and fade out, then the space collapses smoothly.
 *
 * Implementation notes:
 *   - A single full-viewport canvas is shared across all concurrent animations.
 *   - The element is quickly faded out with a CSS opacity transition while the
 *     particles are in flight, so the slot appears to "explode" open.
 *   - All drawing happens on the compositor thread; no layout is triggered
 *     inside the rAF loop.
 */

import { prefersReducedMotion } from "./snap";

const BURST_MS = 700;       // how long particles stay alive
const FADE_EL_MS = 180;     // how fast the element fades to transparent
const COLLAPSE_MS = 220;    // height-collapse phase after burst
const GRAVITY = 0.18;       // px/frame² downward acceleration
const TRAIL_LEN = 5;        // ghost positions kept per particle

// Colour palette: gold, orange, cyan, pink, lime, purple, red, yellow
const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [255, 215, 0],
  [255, 110, 40],
  [40, 220, 255],
  [255, 80, 190],
  [110, 255, 120],
  [190, 90, 255],
  [255, 55, 55],
  [255, 245, 80],
];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rgb: readonly [number, number, number];
  alpha: number;
  decay: number;
  trail: Array<{ x: number; y: number }>;
}

// ── Shared canvas ──────────────────────────────────────────────────────────

let sharedCanvas: HTMLCanvasElement | null = null;
let ctx2d: CanvasRenderingContext2D | null = null;
let rafId = 0;
let activeCount = 0;
const allParticles: Particle[] = [];

function ensureCanvas(): HTMLCanvasElement {
  if (sharedCanvas && sharedCanvas.isConnected) return sharedCanvas;
  sharedCanvas = document.createElement("canvas");
  sharedCanvas.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;";
  document.documentElement.appendChild(sharedCanvas);
  ctx2d = sharedCanvas.getContext("2d");
  resize();
  window.addEventListener("resize", resize, { passive: true });
  return sharedCanvas;
}

function resize(): void {
  if (!sharedCanvas) return;
  sharedCanvas.width = window.innerWidth;
  sharedCanvas.height = window.innerHeight;
}

function startLoop(): void {
  if (rafId) return;
  tick();
}

function tick(): void {
  rafId = requestAnimationFrame(() => {
    draw();
    if (allParticles.length > 0) {
      tick();
    } else {
      rafId = 0;
      // Remove canvas once all animations are done
      if (sharedCanvas && activeCount === 0) {
        sharedCanvas.remove();
        sharedCanvas = null;
        ctx2d = null;
      }
    }
  });
}

function draw(): void {
  const ctx = ctx2d;
  if (!ctx || !sharedCanvas) return;
  ctx.clearRect(0, 0, sharedCanvas.width, sharedCanvas.height);

  for (let i = allParticles.length - 1; i >= 0; i--) {
    const p = allParticles[i]!;

    // Update physics
    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > TRAIL_LEN) p.trail.shift();
    p.vy += GRAVITY;
    p.x += p.vx;
    p.y += p.vy;
    p.alpha -= p.decay;

    if (p.alpha <= 0) {
      allParticles.splice(i, 1);
      continue;
    }

    const [r, g, b] = p.rgb;

    // Draw trail (fades from 0 to current alpha along trail length)
    for (let t = 0; t < p.trail.length; t++) {
      const pt = p.trail[t]!;
      const tAlpha = p.alpha * ((t + 1) / p.trail.length) * 0.4;
      const tR = p.r * (0.4 + 0.6 * ((t + 1) / p.trail.length));
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, tR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${tAlpha.toFixed(3)})`;
      ctx.fill();
    }

    // Draw spark head — bright white core + coloured halo
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 1.4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${(p.alpha * 0.7).toFixed(3)})`;
    ctx.fill();
    // White core
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${(p.alpha * 0.9).toFixed(3)})`;
    ctx.fill();
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface FireworksOptions {
  onCancel: (cancel: () => void) => void;
  collapse: boolean;
}

export function fireworksOut(el: Element, opts: FireworksOptions): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const rect = el.getBoundingClientRect();
    // Centre of the element in viewport coords
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Number of particles scales with element area, capped at 120
    const area = rect.width * rect.height;
    const count = Math.min(120, Math.max(30, Math.round(area / 1200)));
    const rng = mulberry32(cx * 31 + cy * 17 + count);

    ensureCanvas();
    activeCount++;
    let cancelled = false;

    // Register cancel callback
    opts.onCancel(() => {
      cancelled = true;
      restoreEl();
      resolve();
    });

    // ── Fade out the element ────────────────────────────────────────────
    const h = el as HTMLElement;
    const prevTransition = h.style.transition;
    const prevOpacity = h.style.opacity;
    h.style.transition = `opacity ${FADE_EL_MS}ms ease-out`;
    h.style.opacity = "0";

    // ── Emit particles ──────────────────────────────────────────────────
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      // Speed varies: inner ring slow, outer ring fast
      const speed = 2 + rng() * 7;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed - rng() * 3; // bias upward
      const rgb = PALETTE[Math.floor(rng() * PALETTE.length)]!;
      const lifeFrames = 30 + Math.floor(rng() * 20); // ~0.5-0.8 s at 60fps
      allParticles.push({
        x: cx + (rng() - 0.5) * rect.width * 0.4,
        y: cy + (rng() - 0.5) * rect.height * 0.4,
        vx,
        vy,
        r: 1.5 + rng() * 2.5,
        rgb,
        alpha: 0.85 + rng() * 0.15,
        decay: 1 / lifeFrames,
        trail: [],
      });
    }

    startLoop();

    // ── Burst phase: wait for particles to mostly clear ─────────────────
    const burstTimer = setTimeout(() => {
      if (cancelled) return;
      restoreEl();
      if (!opts.collapse) {
        done();
        return;
      }
      collapse();
    }, BURST_MS);

    function restoreEl(): void {
      h.style.transition = prevTransition;
      h.style.opacity = prevOpacity;
    }

    // ── Collapse phase ──────────────────────────────────────────────────
    function collapse(): void {
      const startH = h.offsetHeight;
      const startMarginTop = parseFloat(getComputedStyle(h).marginTop) || 0;
      const startMarginBottom = parseFloat(getComputedStyle(h).marginBottom) || 0;
      const startPaddingTop = parseFloat(getComputedStyle(h).paddingTop) || 0;
      const startPaddingBottom = parseFloat(getComputedStyle(h).paddingBottom) || 0;
      const t0 = performance.now();

      const ease = (t: number) => 1 - Math.pow(1 - t, 3);

      function step(now: number): void {
        if (cancelled) return;
        const prog = ease(Math.min(1, (now - t0) / COLLAPSE_MS));
        h.style.height = startH * (1 - prog) + "px";
        h.style.overflow = "hidden";
        h.style.marginTop = startMarginTop * (1 - prog) + "px";
        h.style.marginBottom = startMarginBottom * (1 - prog) + "px";
        h.style.paddingTop = startPaddingTop * (1 - prog) + "px";
        h.style.paddingBottom = startPaddingBottom * (1 - prog) + "px";
        if (prog < 1) {
          requestAnimationFrame(step);
        } else {
          done();
        }
      }
      requestAnimationFrame(step);
    }

    function done(): void {
      activeCount = Math.max(0, activeCount - 1);
      clearTimeout(burstTimer);
      resolve();
    }
  });
}

// ── Seeded PRNG ────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
