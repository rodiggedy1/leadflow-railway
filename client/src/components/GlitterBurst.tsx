/**
 * GlitterBurst — full-viewport canvas confetti/glitter effect.
 * Renders a fixed overlay canvas, fires 200 glitter particles from
 * random positions along the top of the screen, then unmounts itself
 * after 4 seconds. Trigger by mounting this component.
 */
import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
  shape: "square" | "circle" | "star";
  gravity: number;
  wobble: number;
  wobbleSpeed: number;
  wobbleAngle: number;
}

const COLORS = [
  "#FFD700", "#FFC0CB", "#FF69B4", "#ADFF2F", "#00BFFF",
  "#FF6347", "#DA70D6", "#7FFFD4", "#FFB347", "#E0E0E0",
  "#C0C0C0", "#FF1493", "#00FF7F", "#FF4500", "#9400D3",
];

function makeParticle(canvasW: number): Particle {
  const shape = (["square", "circle", "star"] as const)[Math.floor(Math.random() * 3)];
  return {
    x: Math.random() * canvasW,
    y: -10 - Math.random() * 80,
    vx: (Math.random() - 0.5) * 6,
    vy: 2 + Math.random() * 5,
    size: 4 + Math.random() * 8,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.2,
    opacity: 1,
    shape,
    gravity: 0.12 + Math.random() * 0.1,
    wobble: 0,
    wobbleSpeed: 0.05 + Math.random() * 0.1,
    wobbleAngle: Math.random() * Math.PI * 2,
  };
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const spikes = 5;
  const inner = r * 0.4;
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * r, cy + Math.sin(rot) * r);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner);
    rot += step;
  }
  ctx.lineTo(cx, cy - r);
  ctx.closePath();
}

export default function GlitterBurst({ onDone }: { onDone?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = window.innerWidth;
    let h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w;
      canvas.height = h;
    };
    window.addEventListener("resize", resize);

    // Spawn particles in 3 waves for a more dramatic burst
    const particles: Particle[] = [];
    const spawnWave = (count: number) => {
      for (let i = 0; i < count; i++) particles.push(makeParticle(w));
    };
    spawnWave(120);
    const t1 = setTimeout(() => spawnWave(80), 300);
    const t2 = setTimeout(() => spawnWave(60), 700);

    const startTime = performance.now();
    const duration = 3800; // ms before fade-out completes

    let raf: number;
    const tick = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      const elapsed = now - startTime;
      const globalFade = elapsed > duration * 0.6
        ? 1 - (elapsed - duration * 0.6) / (duration * 0.4)
        : 1;

      for (const p of particles) {
        p.wobbleAngle += p.wobbleSpeed;
        p.wobble = Math.sin(p.wobbleAngle) * 2;
        p.x += p.vx + p.wobble;
        p.y += p.vy;
        p.vy += p.gravity;
        p.rotation += p.rotationSpeed;
        p.opacity = Math.max(0, globalFade);

        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;

        if (p.shape === "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === "star") {
          drawStar(ctx, 0, 0, p.size / 2);
          ctx.fill();
        } else {
          // square / rectangle
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }
        ctx.restore();
      }

      if (elapsed < duration) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, w, h);
        onDone?.();
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", resize);
    };
  }, [onDone]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        pointerEvents: "none",
        width: "100vw",
        height: "100vh",
      }}
    />
  );
}
