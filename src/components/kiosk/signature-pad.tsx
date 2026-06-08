'use client';

import { useEffect, useRef } from 'react';

/**
 * Touch/mouse signature canvas. Emits a PNG data URL after each stroke (null
 * when cleared). High-DPI aware so signatures stay crisp on tablets.
 */
export function SignaturePad({
  onChange,
  clearLabel,
  hint,
}: {
  onChange: (dataUrl: string | null) => void;
  clearLabel: string;
  hint: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Size the backing store to the displayed size × DPR.
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111827';
    };
    resize();

    const pos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const down = (e: PointerEvent) => {
      e.preventDefault();
      drawing.current = true;
      last.current = pos(e);
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drawing.current || !last.current) return;
      e.preventDefault();
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current = p;
      dirty.current = true;
    };
    const up = () => {
      if (!drawing.current) return;
      drawing.current = false;
      last.current = null;
      if (dirty.current) onChange(canvas.toDataURL('image/png'));
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
  }, [onChange]);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    onChange(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative rounded-xl border-2 border-dashed border-border bg-white">
        <canvas ref={canvasRef} className="h-44 w-full touch-none rounded-xl" />
        <span className="pointer-events-none absolute bottom-2 left-3 text-xs font-medium text-muted-foreground select-none">
          {hint}
        </span>
      </div>
      <button
        type="button"
        onClick={clear}
        className="self-end rounded-md px-3 py-1 text-sm font-semibold text-muted-foreground hover:bg-accent"
      >
        {clearLabel}
      </button>
    </div>
  );
}
