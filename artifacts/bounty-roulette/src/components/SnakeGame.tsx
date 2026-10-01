import React, { useEffect, useRef, useState } from 'react';
import { tr } from '../i18n';
import { haptic } from '../hooks/useTelegramWebApp';

const GRID = 15;
const TICK_MS = 150;

type Point = { x: number; y: number };
type Dir = 'up' | 'down' | 'left' | 'right';

const VECTORS: Record<Dir, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

function randomFood(snake: Point[]): Point {
  for (;;) {
    const p = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
    if (!snake.some((s) => s.x === p.x && s.y === p.y)) return p;
  }
}

/**
 * Classic Nokia snake. Walls wrap around; biting itself ends the round and loses everything.
 * The round ends early (as a win) once maxFood is eaten, or when the clock runs out.
 */
export function SnakeGame({
  maxFood,
  durationSec,
  pointsPerFood,
  onEnd,
}: {
  maxFood: number;
  durationSec: number;
  pointsPerFood: number;
  onEnd: (result: { food: number; died: boolean }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snakeRef = useRef<Point[]>([{ x: 7, y: 7 }, { x: 6, y: 7 }, { x: 5, y: 7 }]);
  const dirRef = useRef<Dir>('right');
  const queuedRef = useRef<Dir[]>([]);
  const foodRef = useRef<Point>(randomFood(snakeRef.current));
  const eatenRef = useRef(0);
  const endedRef = useRef(false);
  const startRef = useRef(Date.now());
  const [eaten, setEaten] = useState(0);
  const [left, setLeft] = useState(durationSec);

  function turn(dir: Dir) {
    const last = queuedRef.current[queuedRef.current.length - 1] ?? dirRef.current;
    if (dir === last || dir === OPPOSITE[last]) return;
    if (queuedRef.current.length < 2) queuedRef.current.push(dir);
  }

  function end(died: boolean) {
    if (endedRef.current) return;
    endedRef.current = true;
    haptic(died ? 'heavy' : 'medium');
    onEnd({ food: eatenRef.current, died });
  }

  function draw() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const cell = canvas.width / GRID;
    ctx.fillStyle = '#0b1f14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(134, 239, 172, 0.05)';
    for (let y = 0; y < GRID; y++) for (let x = (y % 2); x < GRID; x += 2) ctx.fillRect(x * cell, y * cell, cell, cell);

    // Apple drawn with shapes (emoji fonts aren't available on every WebView).
    const f = foodRef.current;
    const cx = f.x * cell + cell / 2;
    const cy = f.y * cell + cell / 2 + cell * 0.05;
    ctx.shadowColor = 'rgba(239, 68, 68, 0.8)';
    ctx.shadowBlur = cell * 0.5;
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.arc(cx - cell * 0.12, cy - cell * 0.12, cell * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.ellipse(cx + cell * 0.12, cy - cell * 0.4, cell * 0.14, cell * 0.07, -0.6, 0, Math.PI * 2);
    ctx.fill();

    const sn = snakeRef.current;
    const n = sn.length;
    const shade = (i: number) => {
      const t = n > 1 ? i / (n - 1) : 0;
      return `rgb(${Math.round(34 - 14 * t)}, ${Math.round(197 - 72 * t)}, ${Math.round(94 - 34 * t)})`;
    };
    const padOf = (i: number) => (i === 0 ? 1.5 : i === n - 1 ? 5 : i === n - 2 ? 4 : 3);
    // Smooth connectors between neighbouring segments (skipped across the wrap-around edge).
    for (let i = n - 1; i > 0; i--) {
      const a = sn[i];
      const b = sn[i - 1];
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) continue;
      const th = cell - padOf(i) * 2;
      const ax = a.x * cell + cell / 2;
      const ay = a.y * cell + cell / 2;
      const bx = b.x * cell + cell / 2;
      const by = b.y * cell + cell / 2;
      ctx.fillStyle = shade(i);
      ctx.fillRect(Math.min(ax, bx) - th / 2, Math.min(ay, by) - th / 2, Math.abs(ax - bx) + th, Math.abs(ay - by) + th);
    }
    for (let i = n - 1; i > 0; i--) {
      const p = sn[i];
      const pad = padOf(i);
      ctx.fillStyle = shade(i);
      ctx.beginPath();
      ctx.roundRect(p.x * cell + pad, p.y * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.35);
      ctx.fill();
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
        ctx.beginPath();
        ctx.arc(p.x * cell + cell / 2, p.y * cell + cell / 2, cell * 0.13, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Head: glow, tongue and eyes that face the current direction.
    const h = sn[0];
    const v = VECTORS[dirRef.current];
    const hx = h.x * cell + cell / 2;
    const hy = h.y * cell + cell / 2;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = Math.max(1.5, cell * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx + v.x * cell * 0.4, hy + v.y * cell * 0.4);
    ctx.lineTo(hx + v.x * cell * 0.68, hy + v.y * cell * 0.68);
    ctx.stroke();
    ctx.shadowColor = 'rgba(190, 242, 100, 0.7)';
    ctx.shadowBlur = cell * 0.4;
    ctx.fillStyle = '#bef264';
    ctx.beginPath();
    ctx.roundRect(h.x * cell + 1.5, h.y * cell + 1.5, cell - 3, cell - 3, cell * 0.4);
    ctx.fill();
    ctx.shadowBlur = 0;
    for (const side of [-1, 1]) {
      const ex = hx + v.x * cell * 0.12 + -v.y * side * cell * 0.2;
      const ey = hy + v.y * cell * 0.12 + v.x * side * cell * 0.2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex, ey, cell * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(ex + v.x * cell * 0.04, ey + v.y * cell * 0.04, cell * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  useEffect(() => {
    draw();
    const tick = window.setInterval(() => {
      if (endedRef.current) return;
      const next = queuedRef.current.shift();
      if (next) dirRef.current = next;
      const v = VECTORS[dirRef.current];
      const head = snakeRef.current[0];
      const newHead = { x: (head.x + v.x + GRID) % GRID, y: (head.y + v.y + GRID) % GRID };
      const eats = newHead.x === foodRef.current.x && newHead.y === foodRef.current.y;
      const body = eats ? snakeRef.current : snakeRef.current.slice(0, -1);
      if (body.some((s) => s.x === newHead.x && s.y === newHead.y)) {
        draw();
        end(true);
        return;
      }
      snakeRef.current = [newHead, ...body];
      if (eats) {
        eatenRef.current += 1;
        setEaten(eatenRef.current);
        haptic('light');
        if (eatenRef.current >= maxFood) {
          draw();
          end(false);
          return;
        }
        foodRef.current = randomFood(snakeRef.current);
      }
      draw();
    }, TICK_MS);

    const clock = window.setInterval(() => {
      const remaining = Math.max(0, durationSec - Math.floor((Date.now() - startRef.current) / 1000));
      setLeft(remaining);
      if (remaining <= 0) end(false);
    }, 250);

    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      if (map[e.key]) {
        e.preventDefault();
        turn(map[e.key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(clock);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swipe controls on the board.
  const touchRef = useRef<Point | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchRef.current;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  }

  return (
    <div className="snake-wrap">
      <div className="snake-hud">
        <span>🍎 {eaten}/{maxFood}</span>
        <span className="snake-hud-points">+{(eaten * pointsPerFood).toFixed(2)}</span>
        <span className={left <= 5 ? 'snake-hud-urgent' : ''}>⏱️ {left}{tr('ث', 's')}</span>
      </div>
      <canvas
        ref={canvasRef}
        width={360}
        height={360}
        className="snake-board"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      />
      <div className="snake-pad" dir="ltr">
        <button className="snake-key snake-key-up" onClick={() => turn('up')} aria-label={tr('أعلى', 'Up')}>▲</button>
        <button className="snake-key snake-key-left" onClick={() => turn('left')} aria-label={tr('يسار', 'Left')}>◀</button>
        <button className="snake-key snake-key-right" onClick={() => turn('right')} aria-label={tr('يمين', 'Right')}>▶</button>
        <button className="snake-key snake-key-down" onClick={() => turn('down')} aria-label={tr('أسفل', 'Down')}>▼</button>
      </div>
      <p className="snake-tip">{tr('اسحب على الشاشة أو استخدم الأسهم · لا تصطدم بنفسك! 🐍', 'Swipe on the board or use the arrows · don’t bite yourself! 🐍')}</p>
    </div>
  );
}
