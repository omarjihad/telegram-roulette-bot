import React, { useState } from 'react';
import { api, ApiError } from '../services/api';
import { GamesResponse, SnakeRound } from '../types';
import { LoadingScreen } from '../components/Common';
import { SnakeGame } from '../components/SnakeGame';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { useCountdown } from '../hooks/useCountdown';
import { AdSkippedError, AdUnavailableError, claimAfterAd, showRewardedAd } from '../services/adsgram';

type Result = { reward: number; food: number; died: boolean };

function adError(err: unknown) {
  if (err instanceof AdUnavailableError) return '📭 لا يوجد إعلان حالياً، حاول بعد قليل.';
  if (err instanceof AdSkippedError) return '⚠️ يجب مشاهدة الإعلان حتى النهاية للحصول على المكافأة.';
  if (err instanceof ApiError && err.code === 'AD_NOT_CONFIRMED') return 'لم يتم تأكيد مشاهدة الإعلان، حاول مرة أخرى.';
  if (err instanceof ApiError) return err.message;
  return 'حدث خطأ، حاول مرة أخرى.';
}

function FreeRoundButton({ data, busy, onPlay }: { data: GamesResponse; busy: boolean; onPlay: () => void }) {
  const { label } = useCountdown(data.snake.freeReady ? null : data.snake.freeReadyAt);
  if (data.snake.freeReady) {
    return <button className="btn btn-primary" disabled={busy} onClick={onPlay}>🎮 العب مجاناً</button>;
  }
  return <button className="btn btn-secondary" disabled>⏳ الجولة المجانية بعد {label}</button>;
}

export function GamesPage({ onBack, refreshMe }: { onBack: () => void; refreshMe: () => void }) {
  const { data, error, refetch } = useCachedFetch<GamesResponse>('games', () => api.get<GamesResponse>('/games'));
  const [round, setRound] = useState<SnakeRound | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function flash(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 3000);
  }

  async function startRound(mode: 'free' | 'ad') {
    if (!data || busy) return;
    setBusy(true);
    try {
      if (mode === 'ad') {
        await showRewardedAd(data.blockId);
        setRound(await claimAfterAd<SnakeRound>('/games/snake/start', { mode }));
      } else {
        setRound(await api.post<SnakeRound>('/games/snake/start', { mode }));
      }
    } catch (err) {
      flash(mode === 'ad' ? adError(err) : err instanceof ApiError ? err.message : 'حدث خطأ، حاول مرة أخرى.');
      void refetch().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function finishRound(outcome: { food: number; died: boolean }) {
    if (!round) return;
    try {
      const res = await api.post<{ ok: true } & Result>('/games/snake/finish', { sessionId: round.sessionId, ...outcome });
      setResult({ reward: res.reward, food: res.food, died: res.died });
    } catch {
      setResult({ reward: 0, food: outcome.food, died: outcome.died });
    }
    setRound(null);
    refreshMe();
    void refetch().catch(() => {});
  }

  async function watchAdTask() {
    if (!data || busy) return;
    setBusy(true);
    try {
      await showRewardedAd(data.blockId);
      const res = await claimAfterAd<{ ok: true; reward: number }>('/games/ad-task/claim');
      flash(`✅ ربحت ${res.reward} نقطة!`);
      refreshMe();
      void refetch().catch(() => {});
    } catch (err) {
      flash(adError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!data && error) return <LoadingScreen label="تعذر التحميل، حاول لاحقاً" />;
  if (!data) return <LoadingScreen />;

  if (round) {
    return (
      <div className="games-page">
        <SnakeGame maxFood={round.maxFood} durationSec={round.durationSec} pointsPerFood={round.pointsPerFood} onEnd={finishRound} />
      </div>
    );
  }

  const { snake, adTask } = data;
  return (
    <div className="games-page">
      <div className="header-row">
        <h2 className="page-title" style={{ margin: 0 }}>🎮 العب واربح</h2>
        <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={onBack}>رجوع</button>
      </div>

      {data.comingSoon && (
        <div className="games-soon-banner">
          {data.allowed ? '🧪 وضع الاختبار: الألعاب ظاهرة للمطورين فقط.' : '🔜 قريباً! الألعاب والإعلانات قيد التجهيز.'}
        </div>
      )}

      <div className={`card game-card ${data.allowed ? '' : 'game-card-locked'}`}>
        <div className="game-card-head">
          <div className="game-card-icon">🐍</div>
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>لعبة الحية</h3>
            <p className="card-sub" style={{ margin: 0 }}>كُل التفاح خلال {snake.durationSec} ثانية، وكل تفاحة = {snake.pointsPerFood} نقطة</p>
          </div>
        </div>
        <ul className="game-rules">
          <li>🎁 الجولة المجانية: حتى {snake.freeMaxFood} تفاحات ({(snake.freeMaxFood * snake.pointsPerFood).toFixed(2)} نقطة).</li>
          <li>📺 جولة الإعلان: حتى {snake.adMaxFood} تفاحات ({(snake.adMaxFood * snake.pointsPerFood).toFixed(2)} نقطة) لكل إعلان.</li>
          <li>💥 إذا اصطدمت الحية بنفسها، تخسر كل ما جمعته في الجولة.</li>
        </ul>
        {data.allowed ? (
          <div className="game-actions">
            <FreeRoundButton data={data} busy={busy} onPlay={() => void startRound('free')} />
            <button className="btn btn-secondary game-ad-btn" disabled={busy} onClick={() => void startRound('ad')}>
              📺 شاهد إعلان والعب جولة
            </button>
          </div>
        ) : (
          <button className="btn btn-secondary" disabled>🔜 قريباً</button>
        )}
      </div>

      <div className={`card game-card ${data.allowed ? '' : 'game-card-locked'}`}>
        <div className="game-card-head">
          <div className="game-card-icon">📺</div>
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>شاهد إعلان واربح</h3>
            <p className="card-sub" style={{ margin: 0 }}>
              كل إعلان = {adTask.reward} نقطة{adTask.adsPerSpin ? ` · كل ${adTask.adsPerSpin} إعلان = فرة على عجلة النقاط` : ''}
            </p>
          </div>
        </div>
        {data.allowed ? (
          <button className="btn btn-primary" disabled={busy} onClick={() => void watchAdTask()}>
            {busy ? 'جارٍ التحميل...' : `📺 شاهد إعلان (+${adTask.reward})`}
          </button>
        ) : (
          <button className="btn btn-secondary" disabled>🔜 قريباً</button>
        )}
      </div>

      {result && (
        <div className="modal-backdrop" onClick={() => setResult(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 48 }}>{result.died ? '💥' : '🎉'}</div>
            <h2 style={{ margin: '6px 0' }}>{result.died ? 'اصطدمت بنفسك!' : 'انتهت الجولة'}</h2>
            <p className="card-sub">
              {result.died
                ? `خسرت ${result.food} تفاحات جمعتها في هذه الجولة.`
                : `أكلت ${result.food} تفاحات وربحت ${result.reward} نقطة 🪙`}
            </p>
            <button className="btn btn-primary" onClick={() => setResult(null)}>حسناً</button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
