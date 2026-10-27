import { useEffect, useRef } from "react";

/** 播放中的频谱可视化：从引擎 FFT 取值画柱状。 */
export function Spectrum({ active, getData }: { active: boolean; getData: () => Float32Array | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      return;
    }
    const draw = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        const data = getData();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (data) {
          const bars = data.length;
          const bw = canvas.width / bars;
          for (let i = 0; i < bars; i++) {
            const db = data[i]; // -Infinity..0 dB
            const h = Math.max(2, Math.min(1, (db + 100) / 100)) * canvas.height;
            const grad = ctx.createLinearGradient(0, canvas.height - h, 0, canvas.height);
            grad.addColorStop(0, "rgba(139, 124, 246, 0.95)");
            grad.addColorStop(1, "rgba(78, 205, 196, 0.75)");
            ctx.fillStyle = grad;
            ctx.fillRect(i * bw + 1, canvas.height - h, bw - 2, h);
          }
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, getData]);

  return <canvas ref={canvasRef} className="spectrum" width={720} height={64} />;
}
