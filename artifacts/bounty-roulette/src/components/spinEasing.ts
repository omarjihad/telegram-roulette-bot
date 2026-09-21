/**
 * Speed profile (normalized time t in [0,1]):
 *  - [0, 0.25]  -> constant, very high speed (the "flick")
 *  - [0.25, 1]  -> smooth cubic decay to a full stop, no sudden jerk
 * Over a 12s spin this maps to roughly: 0-3s fast, 3-8s slowing, 8-11s clearly
 * slower, 11-12s gentle final stop — matching the requested feel without a jump cut.
 */
// Precomputed analytical integral of the speed curve over [0,1], used to normalize total rotation.
const TOTAL_SPEED_INTEGRAL = 0.25 + 0.75 * 0.25; // = 0.4375

/** Exact normalized distance travelled at time t; monotonic and exactly 1 at completion. */
export function spinProgress(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped <= 0.25) return clamped / TOTAL_SPEED_INTEGRAL;

  const u = (clamped - 0.25) / 0.75;
  // Integral of (1 - u)^3 du from 0 to u, converted back from u-space to t-space.
  const travelled = 0.25 + 0.75 * (1 - Math.pow(1 - u, 4)) / 4;
  return travelled / TOTAL_SPEED_INTEGRAL;
}

export interface SpinAnimationOptions {
  durationMs: number;
  totalRotationDeg: number;
  onFrame: (currentRotationDeg: number) => void;
  onDone: () => void;
}

export function runSpinAnimation(opts: SpinAnimationOptions): () => void {
  const { durationMs, totalRotationDeg, onFrame, onDone } = opts;
  let start: number | null = null;
  let cancelled = false;

  function frame(now: number) {
    if (cancelled) return;
    if (start === null) start = now;
    const elapsed = now - start;
    const t = Math.min(1, elapsed / durationMs);

    if (t >= 1) {
      onFrame(totalRotationDeg); // snap exactly to target regardless of float drift
      onDone();
      return;
    }

    onFrame(spinProgress(t) * totalRotationDeg);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  return () => {
    cancelled = true;
  };
}
