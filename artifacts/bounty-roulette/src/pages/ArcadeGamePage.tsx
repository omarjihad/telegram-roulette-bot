import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { locale, tr } from '../i18n';
import { api, ApiError } from '../services/api';
import { FlappyRound, GamesResponse, TimerRound } from '../types';
import { LoadingScreen, SectionHero } from '../components/Common';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { useCountdown } from '../hooks/useCountdown';
import { getTelegramWebApp } from '../hooks/useTelegramWebApp';
import { claimAfterAd, showRewardedAd } from '../services/adsgram';
import { adErrorMessage } from '../components/AdTaskCard';

/*
 * Flying and The Timer: each game is a standalone page (public/games/*.html) shown full screen,
 * like the ziggurat. The page reports what happened; this page settles the points with the server.
 */

type Round = FlappyRound | TimerRound;
type Report = { pipes: number; stops: number[] };
type Settled = { reward: number; text: string };

interface GameConfig {
  key: 'flappy' | 'timer';
  source: 'fl' | 'tm';
  emoji: string;
  title: string;
  heroSub: string;
  cardTitle: string;
  how: string;
  playLabel: string;
  frameBg: string;
  rate: (data: GamesResponse) => string;
  free: (data: GamesResponse) => { freeReady: boolean; freeReadyAt: string };
  src: (round: Round) => string;
  // How long the game's own result card stays up before going back.
  endDelayMs: number;
  body: (round: Round, report: Report) => Record<string, unknown>;
  settle: (res: { reward: number; pipes?: number; tries?: Array<{ stop: number; target: number }> }, report: Report) => Settled;
}

// Built on each render, so the texts follow the language picked in the app.
const flappyGame = (): GameConfig => ({
  key: 'flappy',
  source: 'fl',
  emoji: '🐦',
  title: tr('🐦 طيران', '🐦 Flying'),
  heroSub: tr('طيّر العصفور بين الأعمدة واجمع نقاط للعجلة', 'Fly the sparrow between the columns and collect wheel points'),
  cardTitle: tr('لعبة طيران', 'Flying game'),
  how: tr('اضغط حتى يرفرف العصفور وعبّره من الفتحة بين العمودين. إذا لمس عمود أو الكاع تنتهي الجولة.', 'Tap to flap and fly through the gap between the columns. Touch a column or the ground and the round ends.'),
  playLabel: tr('🐦 العب وابدأ في الربح', '🐦 Play and start earning'),
  frameBg: '#0f1236',
  rate: (d) => tr(`كل عمود تعبره = ${d.flappy.pointsPerPipe} نقطة 🪙`, `Every column you pass = ${d.flappy.pointsPerPipe} pts 🪙`),
  free: (d) => d.flappy,
  src: (r) => `/games/flappy.html?embed=1&pts=${encodeURIComponent(String((r as FlappyRound).pointsPerPipe))}`,
  endDelayMs: 2600,
  body: (r, rep) => ({ sessionId: r.sessionId, pipes: rep.pipes }),
  settle: (res, rep) => {
    const pipes = res.pipes ?? rep.pipes;
    return { reward: res.reward, text: tr(`عبرت ${pipes} عمود وربحت ${res.reward} نقطة 🪙`, `You passed ${pipes} columns and won ${res.reward} points 🪙`) };
  },
});

const timerGame = (): GameConfig => ({
  key: 'timer',
  source: 'tm',
  emoji: '⏱️',
  title: tr('⏱️ المؤقت', '⏱️ The Timer'),
  heroSub: tr('وقّف الساعة بالضبط على الرقم واجمع نقاط للعجلة', 'Stop the clock exactly on the number and collect wheel points'),
  cardTitle: tr('لعبة المؤقت', 'The Timer game'),
  how: tr('اضغط ابدأ ووقّف الساعة بالضبط على رقم الهدف. بالضبط = نقاط كاملة، وقريب = جزء منها. آخر محاولتين الساعة تختفي ونقاطهن دبل.', 'Tap start and stop the clock exactly on the target. Exact = full points, close = part of them. On the last two tries the clock hides and points count double.'),
  playLabel: tr('⏱️ العب وابدأ في الربح', '⏱️ Play and start earning'),
  frameBg: '#0a0f2e',
  rate: (d) => tr(`كل مرة توقفها بالضبط = ${d.timer.pointsPerfect} نقطة 🪙 (${d.timer.tries} محاولات بالجولة)`, `Every exact stop = ${d.timer.pointsPerfect} pts 🪙 (${d.timer.tries} tries per round)`),
  free: (d) => d.timer,
  src: (r) => {
    const t = r as TimerRound;
    return `/games/timer.html?embed=1&pts=${encodeURIComponent(String(t.pointsPerfect))}&t=${t.targets.join(',')}&b=${t.blind.map((b) => (b ? 1 : 0)).join(',')}`;
  },
  endDelayMs: 4200,
  body: (r, rep) => ({ sessionId: r.sessionId, stops: rep.stops }),
  settle: (res, rep) => {
    const tries = res.tries ?? rep.stops.map((stop) => ({ stop, target: -1 }));
    const exact = tries.filter((x) => Math.floor(x.stop / 10) * 10 === x.target).length;
    return { reward: res.reward, text: tr(`وقّفتها بالضبط ${exact} مرة وربحت ${res.reward} نقطة 🪙`, `You stopped it exactly ${exact} times and won ${res.reward} points 🪙`) };
  },
});

function FreeRoundButton({ game, data, busy, onPlay }: { game: GameConfig; data: GamesResponse; busy: boolean; onPlay: () => void }) {
  const free = game.free(data);
  const { label } = useCountdown(free.freeReady ? null : free.freeReadyAt);
  if (free.freeReady) {
    return <button className="btn btn-primary" disabled={busy} onClick={onPlay}>{game.playLabel}</button>;
  }
  return <button className="btn btn-secondary" disabled>⏳ {tr('الجولة المجانية بعد', 'Free round in')} {label}</button>;
}

function Player({ game, round, onEnd }: { game: GameConfig; round: Round; onEnd: (report: Report) => void }) {
  const reportRef = useRef<Report>({ pipes: 0, stops: [] });
  const endedRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  function end() {
    if (endedRef.current) return;
    endedRef.current = true;
    onEndRef.current(reportRef.current);
  }

  useEffect(() => {
    let overTimer: number | undefined;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const msg = e.data as { source?: string; type?: string; score?: number; index?: number; stop?: number; stops?: number[] } | null;
      if (!msg || msg.source !== game.source) return;
      const rep = reportRef.current;
      if (msg.type === 'pipe') rep.pipes = Math.max(rep.pipes, Number(msg.score) || 0);
      if (msg.type === 'try' && Number.isInteger(msg.index)) rep.stops[msg.index as number] = Number(msg.stop) || 0;
      if (msg.type === 'over') {
        if (game.key === 'flappy') rep.pipes = Math.max(rep.pipes, Number(msg.score) || 0);
        if (Array.isArray(msg.stops)) rep.stops = msg.stops.map((x) => Number(x) || 0);
        // Let the game's own result card show for a moment first.
        overTimer = window.setTimeout(end, game.endDelayMs);
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

  // On the page body, so it covers the bottom bar and everything else.
  return createPortal(
    <div className="zq-frame-wrap" style={{ background: game.frameBg }}>
      <iframe className="zq-frame" src={game.src(round)} title={game.cardTitle} allow="autoplay; screen-wake-lock" />
      <button type="button" className="ex-zoom-back zq-back" onClick={end}>
        {locale().startsWith('ar') ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        {tr('رجوع', 'Back')}
      </button>
    </div>,
    document.body
  );
}

function ArcadeGamePage({ game, onBack, refreshMe }: { game: GameConfig; onBack: () => void; refreshMe: () => void }) {
  const { data, error, refetch } = useCachedFetch<GamesResponse>('games', () => api.get<GamesResponse>('/games'));
  const [round, setRound] = useState<Round | null>(null);
  const [result, setResult] = useState<Settled | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function flash(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 3000);
  }

  async function startRound(mode: 'free' | 'ad') {
    if (!data || busy) return;
    setBusy(true);
    const path = `/games/${game.key}/start`;
    try {
      if (mode === 'ad') {
        await showRewardedAd(data.blockId);
        setRound(await claimAfterAd<Round>(path, { mode }));
      } else {
        setRound(await api.post<Round>(path, { mode }));
      }
    } catch (err) {
      flash(mode === 'ad' ? adErrorMessage(err) : err instanceof ApiError ? err.message : tr('حدث خطأ، حاول مرة أخرى.', 'Something went wrong, please try again.'));
      void refetch().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function finishRound(report: Report) {
    if (!round) return;
    const current = round;
    setRound(null);
    try {
      const res = await api.post<{ ok: true; reward: number; pipes?: number; tries?: Array<{ stop: number; target: number }> }>(
        `/games/${game.key}/finish`,
        game.body(current, report)
      );
      setResult(game.settle(res, report));
    } catch {
      setResult(game.settle({ reward: 0 }, report));
    }
    refreshMe();
    void refetch().catch(() => {});
  }

  if (!data && error) return <LoadingScreen label={tr('تعذر التحميل، حاول لاحقاً', 'Could not load, try again later')} />;
  if (!data) return <LoadingScreen />;
  if (round) return <Player game={game} round={round} onEnd={(report) => void finishRound(report)} />;

  return (
    <div className="games-page">
      <SectionHero art={game.key} title={game.title} subtitle={game.heroSub} onBack={onBack} />

      {data.comingSoon && (
        <div className="games-soon-banner">
          {data.allowed ? tr('🧪 وضع الاختبار: الألعاب ظاهرة للمطورين فقط.', '🧪 Test mode: games are visible to developers only.') : tr('🔜 قريباً! الألعاب والإعلانات قيد التجهيز.', '🔜 Coming soon! Games and ads are being prepared.')}
        </div>
      )}

      <div className={`card game-card ${data.allowed ? '' : 'game-card-locked'}`}>
        <div className="game-card-head">
          <div className="game-card-icon">{game.emoji}</div>
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>{game.cardTitle}</h3>
            <p className="card-sub" style={{ margin: 0 }}>{game.rate(data)}</p>
          </div>
        </div>
        <p className="card-sub" style={{ margin: 0 }}>{game.how}</p>
        {data.allowed ? (
          <div className="game-actions">
            <FreeRoundButton game={game} data={data} busy={busy} onPlay={() => void startRound('free')} />
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
            <div style={{ fontSize: 48 }}>{game.emoji}</div>
            <h2 style={{ margin: '6px 0' }}>{tr('انتهت الجولة', 'Round over')}</h2>
            <p className="card-sub">{result.text}</p>
            <button className="btn btn-primary" onClick={() => setResult(null)}>{tr('حسناً', 'OK')}</button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export function FlappyPage(props: { onBack: () => void; refreshMe: () => void }) {
  return <ArcadeGamePage game={flappyGame()} {...props} />;
}

export function TimerPage(props: { onBack: () => void; refreshMe: () => void }) {
  return <ArcadeGamePage game={timerGame()} {...props} />;
}
