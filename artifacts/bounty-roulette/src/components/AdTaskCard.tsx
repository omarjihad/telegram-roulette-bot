import React, { useState } from 'react';
import { api, ApiError } from '../services/api';
import { GamesResponse } from '../types';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { AdSkippedError, AdUnavailableError, claimAfterAd, showRewardedAd } from '../services/adsgram';

export function adErrorMessage(err: unknown) {
  if (err instanceof AdUnavailableError) return '📭 لا يوجد إعلان حالياً، حاول بعد قليل.';
  if (err instanceof AdSkippedError) return '⚠️ يجب مشاهدة الإعلان حتى النهاية للحصول على المكافأة.';
  if (err instanceof ApiError && err.code === 'AD_NOT_CONFIRMED') return 'لم يتم تأكيد مشاهدة الإعلان، حاول مرة أخرى.';
  if (err instanceof ApiError) return err.message;
  return 'حدث خطأ، حاول مرة أخرى.';
}

/** "Watch an ad, earn points" — shown first on the Tasks page and on the games page. */
export function AdTaskCard({ onEarned }: { onEarned?: () => void }) {
  const { data, refetch } = useCachedFetch<GamesResponse>('games', () => api.get<GamesResponse>('/games'));
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function flash(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 3000);
  }

  async function watch() {
    if (!data || busy) return;
    setBusy(true);
    try {
      await showRewardedAd(data.blockId);
      const res = await claimAfterAd<{ ok: true; reward: number }>('/games/ad-task/claim');
      flash(`✅ ربحت ${res.reward} نقطة!`);
      onEarned?.();
      void refetch().catch(() => {});
    } catch (err) {
      flash(adErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;
  return (
    <div className={`card game-card ${data.allowed ? '' : 'game-card-locked'}`}>
      <div className="game-card-head">
        <div className="game-card-icon">📺</div>
        <div>
          <h3 className="card-title" style={{ margin: 0 }}>شاهد إعلان واربح</h3>
          <p className="card-sub" style={{ margin: 0 }}>تربح {data.adTask.reward} نقطة عن كل إعلان تشاهده للنهاية</p>
        </div>
      </div>
      {data.allowed ? (
        <button className="btn btn-primary" disabled={busy} onClick={() => void watch()}>
          {busy ? 'جارٍ التحميل...' : '📺 شاهد إعلان'}
        </button>
      ) : (
        <button className="btn btn-secondary" disabled>🔜 قريباً</button>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
