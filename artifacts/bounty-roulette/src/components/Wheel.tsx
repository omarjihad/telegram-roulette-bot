import React, { useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { WheelSlot } from './wheelSlots';
import { runSpinAnimation } from './spinEasing';
import { ReelMetrics, reelSpinPlan, reelTranslateX, normalizeSlotIndex } from './reelGeometry';
import './wheel-layout.css';

// The strip needs only the start, four visible laps, and a short tail. It is deliberately
// bounded; animation mutates its DOM transform rather than re-rendering every card per frame.
const REPEATS = 9;
const INITIAL_LAP = 2;
const FULL_LAPS = 4;
const DEFAULT_CARD_WIDTH = 92;
const DEFAULT_CARD_GAP = 12;

export interface WheelHandle {
  spinTo: (targetSlotIndex: number, durationMs: number, onDone: () => void) => void;
}

export const Wheel = React.forwardRef<
  WheelHandle,
  { slots: WheelSlot[]; width?: number; initialSlotIndex?: number | null; showAvailability?: boolean }
>(function Wheel({ slots, width = 420, initialSlotIndex, showAvailability = false }, ref) {
  const slotCount = Math.max(slots.length, 1);
  const stripLength = slotCount * REPEATS;
  const viewportRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const baseIdxRef = useRef(slotCount * INITIAL_LAP);
  const isSpinningRef = useRef(false);
  const metricsRef = useRef<ReelMetrics>({
    viewportWidth: width,
    cardWidth: DEFAULT_CARD_WIDTH,
    pitch: DEFAULT_CARD_WIDTH + DEFAULT_CARD_GAP,
  });
  const [landedAbsIdx, setLandedAbsIdx] = useState<number | null>(null);

  const positionStrip = (slotIndex: number) => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.style.transform = `translate3d(${reelTranslateX(slotIndex, metricsRef.current)}px, 0, 0)`;
  };

  // Read the actual dimensions after each slot-list render and on viewport resizes. `clientWidth`
  // is the viewport's content box, the same coordinate system used by absolute `left: 0`.
  useLayoutEffect(() => {
    const updateMetrics = () => {
      const viewport = viewportRef.current;
      const card = cardRef.current;
      const strip = stripRef.current;
      if (!viewport || !card || !strip) return;
      const gap = Number.parseFloat(getComputedStyle(strip).columnGap) || DEFAULT_CARD_GAP;
      const cardWidth = card.getBoundingClientRect().width || DEFAULT_CARD_WIDTH;
      metricsRef.current = {
        viewportWidth: viewport.clientWidth,
        cardWidth,
        pitch: cardWidth + gap,
      };
      positionStrip(baseIdxRef.current);
    };
    updateMetrics();
    const observer = new ResizeObserver(updateMetrics);
    if (viewportRef.current) observer.observe(viewportRef.current);
    return () => observer.disconnect();
    // Re-measure whenever the number/pitch of rendered cards can change.
  }, [slotCount]);

  // Resting on a server-confirmed last result must use an actual slot key, not a visual
  // override. The parent guarantees it has added any missing historic key before this runs.
  useLayoutEffect(() => {
    if (isSpinningRef.current || initialSlotIndex === null || initialSlotIndex === undefined || slotCount <= 0) return;
    const target = slotCount * INITIAL_LAP + normalizeSlotIndex(initialSlotIndex, slotCount);
    baseIdxRef.current = target;
    positionStrip(target);
    setLandedAbsIdx(target);
  }, [initialSlotIndex, slotCount]);

  useImperativeHandle(
    ref,
    () => ({
      spinTo(targetSlotIndex, durationMs, onDone) {
        if (isSpinningRef.current || slotCount <= 0) return;
        isSpinningRef.current = true;
        setLandedAbsIdx(null);

        const currentIdx = baseIdxRef.current;
        const plan = reelSpinPlan(currentIdx, targetSlotIndex, slotCount, FULL_LAPS, INITIAL_LAP);

        runSpinAnimation({
          durationMs,
          totalRotationDeg: plan.travelSlots,
          // Imperative transform avoids React reconciling up to hundreds of image cards at
          // animation-frame frequency, the source of the previously visible stutter.
          onFrame: (delta) => positionStrip(currentIdx + delta),
          onDone: () => {
            // Rebase by whole laps to a bounded, identical modulo position before the next
            // spin. This is visually invariant and keeps the target DOM element real.
            const settled = plan.settledAbsoluteIndex;
            baseIdxRef.current = settled;
            positionStrip(settled);
            setLandedAbsIdx(settled);
            isSpinningRef.current = false;
            onDone();
          },
        });
      },
    }),
    [slotCount]
  );

  const cards = useMemo(
    () =>
      Array.from({ length: stripLength }, (_, index) => ({
        index,
        slot: slots[index % slotCount],
      })),
    [slots, slotCount, stripLength]
  );

  return (
    <div className="reel-wrap" data-reel-root="true">
      <div className="reel-pointer reel-pointer-top" data-reel-pointer="top" aria-hidden="true" />
      <div
        className="reel-viewport"
        ref={viewportRef}
        style={{ width: '100%', maxWidth: width }}
        data-reel-viewport="true"
        data-reel-landed-key={landedAbsIdx === null ? undefined : slots[landedAbsIdx % slotCount]?.key}
      >
        <div className="reel-fade reel-fade-left" />
        <div className="reel-fade reel-fade-right" />
        <div className="reel-strip" ref={stripRef} style={{ gap: DEFAULT_CARD_GAP }} data-reel-strip="true">
          {cards.map(({ index, slot }) => {
            const isLanded = landedAbsIdx === index;
            const availabilityClass =
              showAvailability && slot.availability === 'out_of_stock'
                ? ' reel-card-exhausted'
                : showAvailability && !slot.isAvailable
                  ? ' reel-card-unavailable'
                  : '';
            return (
              <div
                key={index}
                ref={index === 0 ? cardRef : undefined}
                className={`reel-card${isLanded ? ' reel-card-landed' : ''}${availabilityClass}`}
                style={{ width: DEFAULT_CARD_WIDTH }}
                data-reel-slot-key={slot.key}
                data-reel-slot-index={index}
                data-reel-landed={isLanded ? 'true' : 'false'}
              >
                {slot.imageUrl ? (
                  <img src={slot.imageUrl} alt="" className="reel-card-image" loading="lazy" />
                ) : (
                  <div className="reel-card-icon">{slot.icon}</div>
                )}
                <div className="reel-card-label">{slot.label}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="reel-pointer reel-pointer-bottom" data-reel-pointer="bottom" aria-hidden="true" />
    </div>
  );
});