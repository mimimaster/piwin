/**
 * Canvas side panel — freehand drawing surface.
 */

import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';

const PRESET_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#111827'];

export function CanvasPanel(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState('#3b82f6');
  const [brushSize, setBrushSize] = useState(2);

  function resizeCanvas(): void {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    // Preserve content while resizing.
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (tempCtx && canvas.width > 0 && canvas.height > 0) {
      tempCtx.drawImage(canvas, 0, 0);
    }

    const dpr = window.devicePixelRatio ?? 1;
    const rect = parent.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (tempCtx && canvas.width > 0 && canvas.height > 0) {
      ctx.drawImage(tempCanvas, 0, 0, rect.width, rect.height);
    }
  }

  useEffect(() => {
    resizeCanvas();
    const handleResize = (): void => resizeCanvas();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  function getPoint(event: MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startDrawing(event: MouseEvent<HTMLCanvasElement>): void {
    isDrawing.current = true;
    const point = getPoint(event);
    lastPos.current = point;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw(event: MouseEvent<HTMLCanvasElement>): void {
    if (!isDrawing.current || !lastPos.current) return;
    const point = getPoint(event);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPos.current = point;
  }

  function stopDrawing(): void {
    isDrawing.current = false;
    lastPos.current = null;
  }

  function clearCanvas(): void {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio ?? 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  }

  function saveCanvas(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `piwin-canvas-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  return (
    <div className="canvas-panel" data-testid="canvas-panel">
      <div className="canvas-panel-toolbar">
        <div className="canvas-panel-colors">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={c === color ? 'canvas-swatch active' : 'canvas-swatch'}
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <input
          className="canvas-panel-size"
          type="range"
          min={1}
          max={24}
          step={1}
          value={brushSize}
          aria-label="Brush size"
          onChange={(event: ChangeEvent<HTMLInputElement>) => setBrushSize(Number(event.target.value))}
        />
        <div className="canvas-panel-actions">
          <Button type="button" variant="ghost" onClick={clearCanvas}>
            Clear
          </Button>
          <Button type="button" onClick={saveCanvas}>
            Save
          </Button>
        </div>
      </div>
      <div className="canvas-panel-surface">
        <canvas
          ref={canvasRef}
          className="canvas-panel-canvas"
          data-testid="canvas-canvas"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
        />
      </div>
    </div>
  );
}
