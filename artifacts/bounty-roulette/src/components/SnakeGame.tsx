import React, { useEffect, useRef, useState } from 'react';
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

    snakeRef.current.forEach((p, i) => {
      ctx.fillStyle = i === 0 ? '#facc15' : i % 2 ? '#22c55e' : '#16a34a';
      const pad = i === 0 ? 1 : 2;
      ctx.beginPath();
      ctx.roundRect(p.x * cell + pad, p.y * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.3);
      ctx.fill();
    });
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
        <span className={left <= 5 ? 'snake-hud-urgent' : ''}>⏱️ {left}ث</span>
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
        <button className="snake-key snake-key-up" onClick={() => turn('up')} aria-label="أعلى">▲</button>
        <button className="snake-key snake-key-left" onClick={() => turn('left')} aria-label="يسار">◀</button>
        <button className="snake-key snake-key-right" onClick={() => turn('right')} aria-label="يمين">▶</button>
        <button className="snake-key snake-key-down" onClick={() => turn('down')} aria-label="أسفل">▼</button>
      </div>
      <p className="snake-tip">اسحب على الشاشة أو استخدم الأسهم · لا تصطدم بنفسك! 🐍</p>
    </div>
  );
}
