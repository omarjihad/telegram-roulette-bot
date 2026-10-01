import React, { useState } from 'react';
import { tr } from '../i18n';
import { api, ApiError } from '../services/api';
import { GamesResponse } from '../types';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { AdPreviewError, AdSkippedError, AdUnavailableError, claimAfterAd, showRewardedAd } from '../services/adsgram';
import { isPreviewMode } from '../services/preview';

export function adErrorMessage(err: unknown) {
  if (err instanceof AdPreviewError) return tr('📺 الإعلانات تعمل داخل تيليجرام فقط. افتح البوت لمشاهدة الإعلان وربح النقاط.', '📺 Ads work only inside Telegram. Open the bot to watch ads and earn points.');
  if (err instanceof AdUnavailableError) return tr('📭 لا يوجد إعلان حالياً، حاول بعد قليل.', '📭 No ad available right now, try again shortly.');
  if (err instanceof AdSkippedError) return tr('⚠️ يجب مشاهدة الإعلان حتى النهاية للحصول على المكافأة.', '⚠️ Watch the ad to the end to get the reward.');
  if (err instanceof ApiError && err.code === 'AD_NOT_CONFIRMED') return tr('لم يتم تأكيد مشاهدة الإعلان، حاول مرة أخرى.', 'The ad view was not confirmed, please try again.');
  if (err instanceof ApiError) return err.message;
  return tr('حدث خطأ، حاول مرة أخرى.', 'Something went wrong, please try again.');
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
    if (isPreviewMode()) {
      flash(tr('📺 الإعلانات تعمل داخل تيليجرام فقط. افتح البوت لمشاهدة الإعلان وربح النقاط.', '📺 Ads work only inside Telegram. Open the bot to watch ads and earn points.'));
      return;
    }
    setBusy(true);
    try {
      await showRewardedAd(data.blockId);
      const res = await claimAfterAd<{ ok: true; reward: number }>('/games/ad-task/claim');
      flash(tr(`✅ ربحت ${res.reward} نقطة!`, `✅ You earned ${res.reward} points!`));
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
          <h3 className="card-title" style={{ margin: 0 }}>{tr('شاهد إعلان واربح', 'Watch an ad & earn')}</h3>
          <p className="card-sub" style={{ margin: 0 }}>{tr(`تربح ${data.adTask.reward} نقطة عن كل إعلان تشاهده للنهاية`, `Earn ${data.adTask.reward} points for every ad you watch to the end`)}</p>
        </div>
      </div>
      {data.allowed ? (
        <button className="btn btn-primary" disabled={busy} onClick={() => void watch()}>
          {busy ? tr('جارٍ التحميل...', 'Loading...') : tr('📺 شاهد إعلان', '📺 Watch an ad')}
        </button>
      ) : (
        <button className="btn btn-secondary" disabled>{tr('🔜 قريباً', '🔜 Soon')}</button>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
