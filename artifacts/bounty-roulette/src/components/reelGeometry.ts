export interface ReelMetrics {
  viewportWidth: number;
  cardWidth: number;
  pitch: number;
}

export function normalizeSlotIndex(index: number, slotCount: number): number {
  return ((index % slotCount) + slotCount) % slotCount;
}

/**
 * The sole horizontal geometry equation for the reel. It centers the physical card center
 * on the viewport's content-box center; callers supply DOM-measured values.
 */
export function reelTranslateX(slotIndex: number, metrics: ReelMetrics): number {
  return metrics.viewportWidth / 2 - (slotIndex * metrics.pitch + metrics.cardWidth / 2);
}

export function reelSpinPlan(
  currentAbsoluteIndex: number,
  targetSlotIndex: number,
  slotCount: number,
  fullLaps: number,
  rebaseLap: number
): { travelSlots: number; settledAbsoluteIndex: number } {
  const currentSlot = normalizeSlotIndex(currentAbsoluteIndex, slotCount);
  const targetSlot = normalizeSlotIndex(targetSlotIndex, slotCount);
  return {
    travelSlots: fullLaps * slotCount + normalizeSlotIndex(targetSlot - currentSlot, slotCount),
    settledAbsoluteIndex: rebaseLap * slotCount + targetSlot,
  };
}