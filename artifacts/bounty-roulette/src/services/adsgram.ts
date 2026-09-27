import { api, ApiError } from './api';

// Adsgram rewarded-ads SDK: https://sad.adsgram.ai/js/sad.min.js
interface AdsgramShowResult { done: boolean; description?: string; state?: string; error?: boolean }
interface AdsgramController { show: () => Promise<AdsgramShowResult> }
declare global {
  interface Window {
    Adsgram?: { init: (params: { blockId: string; debug?: boolean }) => AdsgramController };
  }
}

const SDK_URL = 'https://sad.adsgram.ai/js/sad.min.js';
let sdkPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.Adsgram) return Promise.resolve();
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SDK_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        sdkPromise = null;
        reject(new Error('sdk'));
      };
      document.head.appendChild(script);
    });
  }
  return sdkPromise;
}

export class AdUnavailableError extends Error {}
export class AdSkippedError extends Error {}

/**
 * Shows one rewarded ad. Resolves only when the user watched it to the end.
 * No ad to show → AdUnavailableError; closed early → AdSkippedError.
 */
export async function showRewardedAd(blockId: string): Promise<void> {
  try {
    await loadSdk();
  } catch {
    throw new AdUnavailableError('no-sdk');
  }
  if (!window.Adsgram) throw new AdUnavailableError('no-sdk');
  let result: AdsgramShowResult;
  try {
    result = await window.Adsgram.init({ blockId }).show();
  } catch (err) {
    const r = err as AdsgramShowResult;
    if (r && r.error === false) throw new AdSkippedError(r.description ?? 'skipped');
    throw new AdUnavailableError(r?.description ?? 'no-ad');
  }
  if (!result.done) throw new AdSkippedError('skipped');
}

/**
 * Calls a reward endpoint after an ad. The server only pays for views Adsgram confirmed
 * to it directly, which can arrive a moment after the ad closes, so this retries briefly.
 */
export async function claimAfterAd<T>(path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api.post<T>(path, body);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AD_NOT_CONFIRMED' && attempt < 6) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }
}
