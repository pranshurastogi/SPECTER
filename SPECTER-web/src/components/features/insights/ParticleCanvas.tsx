import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  speed: number;
  opacity: number;
  fadeStart: number;
  fadingOut: boolean;
}

function makeParticle(canvas: HTMLCanvasElement): Particle {
  return reset({ x: 0, y: 0, speed: 0, opacity: 1, fadeStart: 0, fadingOut: false }, canvas, true);
}

function reset(p: Particle, canvas: HTMLCanvasElement, randomY = false): Particle {
  p.x = Math.random() * canvas.width;
  p.y = randomY ? Math.random() * canvas.height : canvas.height;
  p.speed = Math.random() * 0.4 + 0.15;
  p.opacity = 1;
  p.fadeStart = Date.now() + Math.random() * 700 + 200;
  p.fadingOut = false;
  return p;
}

function updateParticle(p: Particle, canvas: HTMLCanvasElement) {
  p.y -= p.speed;
  if (p.y < 0) reset(p, canvas);

  if (!p.fadingOut && Date.now() > p.fadeStart) p.fadingOut = true;
  if (p.fadingOut) {
    p.opacity -= 0.007;
    if (p.opacity <= 0) reset(p, canvas);
  }
}

function drawParticle(p: Particle, ctx: CanvasRenderingContext2D) {
  // Gold/amber tones: r ~200-255, g ~140-180, b ~0-40
  const r = 220 + Math.floor(Math.random() * 35);
  const g = 140 + Math.floor(Math.random() * 50);
  const b = Math.floor(Math.random() * 30);
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.opacity})`;
  ctx.fillRect(p.x, p.y, 0.5, Math.random() * 2.5 + 0.8);
}

export function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<{ particles: Particle[]; raf: number }>({ particles: [], raf: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const init = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      const count = Math.floor((canvas.width * canvas.height) / 5000);
      stateRef.current.particles = Array.from({ length: count }, () => makeParticle(canvas));
    };

    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      stateRef.current.particles.forEach((p) => {
        updateParticle(p, canvas);
        drawParticle(p, ctx);
      });
      stateRef.current.raf = requestAnimationFrame(loop);
    };

    init();
    loop();

    const onResize = () => init();
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(stateRef.current.raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden="true"
    />
  );
}
