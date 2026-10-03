import React, { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { api, ApiError } from '../services/api';
import { GamesResponse, SnakeRound } from '../types';
import { LoadingScreen, SectionHero } from '../components/Common';
import { SnakeGame } from '../components/SnakeGame';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { useCountdown } from '../hooks/useCountdown';
import { claimAfterAd, showRewardedAd } from '../services/adsgram';
import { adErrorMessage } from '../components/AdTaskCard';

type Result = { reward: number; food: number; died: boolean };

function FreeRoundButton({ data, busy, onPlay }: { data: GamesResponse; busy: boolean; onPlay: () => void }) {
  const { label } = useCountdown(data.snake.freeReady ? null : data.snake.freeReadyAt);
  if (data.snake.freeReady) {
    return <button className="btn btn-primary" disabled={busy} onClick={onPlay}>{tr('🎮 العب وابدأ في الربح', '🎮 Play and start earning')}</button>;
  }
  return <button className="btn btn-secondary" disabled>⏳ {tr('الجولة المجانية بعد', 'Free round in')} {label}</button>;
}

export function GamesPage({ onBack, refreshMe }: { onBack: () => void; refreshMe: () => void }) {
  const { data, error, refetch } = useCachedFetch<GamesResponse>('games', () => api.get<GamesResponse>('/games'));
  const [round, setRound] = useState<SnakeRound | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // The play buttons sit lower on the page; start each round scrolled to the top so the
  // score bar and the whole board are in view.
  useEffect(() => {
    if (round) window.scrollTo(0, 0);
  }, [round]);

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
      flash(mode === 'ad' ? adErrorMessage(err) : err instanceof ApiError ? err.message : tr('حدث خطأ، حاول مرة أخرى.', 'Something went wrong, please try again.'));
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

  if (!data && error) return <LoadingScreen label={tr('تعذر التحميل، حاول لاحقاً', 'Could not load, try again later')} />;
  if (!data) return <LoadingScreen />;

  if (round) {
    return (
      <div className="games-page">
        <SnakeGame maxFood={round.maxFood} durationSec={round.durationSec} pointsPerFood={round.pointsPerFood} onEnd={finishRound} />
      </div>
    );
  }

  const { snake } = data;
  return (
    <div className="games-page">
      <SectionHero
        art="snake"
        title={tr('🐍 لعبة الحية', '🐍 Snake')}
        subtitle={tr('كُل التفاح واجمع نقاط للعجلة', 'Eat apples and collect wheel points')}
        onBack={onBack}
      />

      {data.comingSoon && (
        <div className="games-soon-banner">
          {data.allowed ? tr('🧪 وضع الاختبار: الألعاب ظاهرة للمطورين فقط.', '🧪 Test mode: games are visible to developers only.') : tr('🔜 قريباً! الألعاب والإعلانات قيد التجهيز.', '🔜 Coming soon! Games and ads are being prepared.')}
        </div>
      )}

      <div className={`card game-card ${data.allowed ? '' : 'game-card-locked'}`}>
        <div className="game-card-head">
          <div className="game-card-icon">🐍</div>
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>{tr('لعبة الحية', 'Snake game')}</h3>
            <p className="card-sub" style={{ margin: 0 }}>{tr('كُل التفاح واجمع النقاط 🍎', 'Eat apples and collect points 🍎')}</p>
          </div>
        </div>
        <p className="card-sub" style={{ margin: 0 }}>{tr('💥 انتبه! إذا اصطدمت الحية بنفسها تخسر كل ما جمعته.', '💥 Careful! If the snake bites itself you lose everything you collected.')}</p>
        {data.allowed ? (
          <div className="game-actions">
            <FreeRoundButton data={data} busy={busy} onPlay={() => void startRound('free')} />
            <button className="btn btn-secondary game-ad-btn" disabled={busy} onClick={() => void startRound('ad')}>
              {tr('📺 شاهد إعلان والعب', '📺 Watch an ad and play')}
            </button>
          </div>
        ) : (
          <button className="btn btn-secondary" disabled>{tr('🔜 قريباً', '🔜 Soon')}</button>
        )}
      </div>


      {result && (
        <div className="modal-backdrop" onClick={() => setResult(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 48 }}>{result.died ? '💥' : '🎉'}</div>
            <h2 style={{ margin: '6px 0' }}>{result.died ? tr('اصطدمت بنفسك!', 'You bit yourself!') : tr('انتهت الجولة', 'Round over')}</h2>
            <p className="card-sub">
              {result.died
                ? tr(`خسرت ${result.food} تفاحات جمعتها في هذه الجولة.`, `You lost the ${result.food} apples you collected this round.`)
                : tr(`أكلت ${result.food} تفاحات وربحت ${result.reward} نقطة 🪙`, `You ate ${result.food} apples and won ${result.reward} points 🪙`)}
            </p>
            <button className="btn btn-primary" onClick={() => setResult(null)}>{tr('حسناً', 'OK')}</button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
