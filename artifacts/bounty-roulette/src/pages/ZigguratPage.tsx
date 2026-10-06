import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { locale, tr } from '../i18n';
import { api, ApiError } from '../services/api';
import { GamesResponse, ZigguratRound } from '../types';
import { LoadingScreen, SectionHero } from '../components/Common';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { useCountdown } from '../hooks/useCountdown';
import { getTelegramWebApp } from '../hooks/useTelegramWebApp';
import { claimAfterAd, showRewardedAd } from '../services/adsgram';
import { adErrorMessage } from '../components/AdTaskCard';

type Result = { reward: number; floors: number };

function FreeRoundButton({ data, busy, onPlay }: { data: GamesResponse; busy: boolean; onPlay: () => void }) {
  const { label } = useCountdown(data.ziggurat.freeReady ? null : data.ziggurat.freeReadyAt);
  if (data.ziggurat.freeReady) {
    return <button className="btn btn-primary" disabled={busy} onClick={onPlay}>{tr('🏛️ العب وابدأ في الربح', '🏛️ Play and start earning')}</button>;
  }
  return <button className="btn btn-secondary" disabled>⏳ {tr('الجولة المجانية بعد', 'Free round in')} {label}</button>;
}

/**
 * The ziggurat stacking game. The game itself is a standalone page (public/games/ziggurat.html)
 * shown full screen; it reports each floor and the end of the round, and this page settles
 * the points with the server.
 */
function ZigguratPlayer({ round, onEnd }: { round: ZigguratRound; onEnd: (floors: number) => void }) {
  const floorsRef = useRef(0);
  const endedRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  function end() {
    if (endedRef.current) return;
    endedRef.current = true;
    onEndRef.current(floorsRef.current);
  }

  useEffect(() => {
    let overTimer: number | undefined;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const msg = e.data as { source?: string; type?: string; score?: number } | null;
      if (!msg || msg.source !== 'zq') return;
      if (msg.type === 'floor') floorsRef.current = Math.max(floorsRef.current, Number(msg.score) || 0);
      if (msg.type === 'over') {
        floorsRef.current = Math.max(floorsRef.current, Number(msg.score) || 0);
        // Let the tower's fall and the result card play for a moment first.
        overTimer = window.setTimeout(end, 2600);
      }
    };
    window.addEventListener('message', onMessage);
    // The bot's page behind the game isn't drawn while it plays.
    document.body.classList.add('zq-open');
    const back = getTelegramWebApp()?.BackButton;
    back?.onClick(end);
    back?.show();
    return () => {
      window.removeEventListener('message', onMessage);
      document.body.classList.remove('zq-open');
      window.clearTimeout(overTimer);
      back?.offClick(end);
      back?.hide();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const src = `/games/ziggurat.html?embed=1&pts=${encodeURIComponent(String(round.pointsPerFloor))}`;
  // On the page body, so it covers the bottom bar and everything else.
  return createPortal(
    <div className="zq-frame-wrap">
      <iframe className="zq-frame" src={src} title={tr('زقورة', 'Ziggurat')} allow="autoplay; screen-wake-lock" />
      <button type="button" className="ex-zoom-back zq-back" onClick={end}>
        {locale().startsWith('ar') ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        {tr('رجوع', 'Back')}
      </button>
    </div>,
    document.body
  );
}

export function ZigguratPage({ onBack, refreshMe }: { onBack: () => void; refreshMe: () => void }) {
  const { data, error, refetch } = useCachedFetch<GamesResponse>('games', () => api.get<GamesResponse>('/games'));
  const [round, setRound] = useState<ZigguratRound | null>(null);
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
        setRound(await claimAfterAd<ZigguratRound>('/games/ziggurat/start', { mode }));
      } else {
        setRound(await api.post<ZigguratRound>('/games/ziggurat/start', { mode }));
      }
    } catch (err) {
      flash(mode === 'ad' ? adErrorMessage(err) : err instanceof ApiError ? err.message : tr('حدث خطأ، حاول مرة أخرى.', 'Something went wrong, please try again.'));
      void refetch().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function finishRound(floors: number) {
    if (!round) return;
    const current = round;
    setRound(null);
    try {
      const res = await api.post<{ ok: true } & Result>('/games/ziggurat/finish', { sessionId: current.sessionId, floors });
      setResult({ reward: res.reward, floors: res.floors });
    } catch {
      setResult({ reward: 0, floors });
    }
    refreshMe();
    void refetch().catch(() => {});
  }

  if (!data && error) return <LoadingScreen label={tr('تعذر التحميل، حاول لاحقاً', 'Could not load, try again later')} />;
  if (!data) return <LoadingScreen />;
  if (round) return <ZigguratPlayer round={round} onEnd={(floors) => void finishRound(floors)} />;

  const { ziggurat } = data;
  return (
    <div className="games-page">
      <SectionHero
        art="ziggurat"
        title={tr('🏛️ زقورة', '🏛️ Ziggurat')}
        subtitle={tr('رصّ الطابوق وعلّي الزقورة واجمع نقاط للعجلة', 'Stack the bricks, raise the ziggurat, collect wheel points')}
        onBack={onBack}
      />

      {data.comingSoon && (
        <div className="games-soon-banner">
          {data.allowed ? tr('🧪 وضع الاختبار: الألعاب ظاهرة للمطورين فقط.', '🧪 Test mode: games are visible to developers only.') : tr('🔜 قريباً! الألعاب والإعلانات قيد التجهيز.', '🔜 Coming soon! Games and ads are being prepared.')}
        </div>
      )}

      <div className={`card game-card ${data.allowed ? '' : 'game-card-locked'}`}>
        <div className="game-card-head">
          <div className="game-card-icon">🏛️</div>
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>{tr('لعبة زقورة', 'Ziggurat game')}</h3>
            <p className="card-sub" style={{ margin: 0 }}>
              {tr(`كل طابوقة تثبت على الزقورة = ${ziggurat.pointsPerFloor} نقطة 🪙`, `Every brick that stays on the tower = ${ziggurat.pointsPerFloor} pts 🪙`)}
            </p>
          </div>
        </div>
        <p className="card-sub" style={{ margin: 0 }}>
          {tr('اضغط حتى تنزّل الطابوقة فوق اللي قبلها. اللي يطلع برّا الحافة ينگص، وإذا طاحت كلها تنتهي الجولة.', 'Tap to drop each brick on the one below. Whatever hangs over the edge is cut off; miss completely and the round ends.')}
        </p>
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
            <div style={{ fontSize: 48 }}>🏛️</div>
            <h2 style={{ margin: '6px 0' }}>{tr('انتهت الجولة', 'Round over')}</h2>
            <p className="card-sub">
              {tr(`علّيت ${result.floors} طابق وربحت ${result.reward} نقطة 🪙`, `You stacked ${result.floors} floors and won ${result.reward} points 🪙`)}
            </p>
            <button className="btn btn-primary" onClick={() => setResult(null)}>{tr('حسناً', 'OK')}</button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
