import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Wheel, WheelHandle } from '../components/Wheel';
import { buildWheelSlots, findSlotIndexForKey, PublicPrize } from '../components/wheelSlots';
import { useCountdown } from '../hooks/useCountdown';
import { useCachedFetch, invalidateCache } from '../hooks/useCachedFetch';
import { api, ApiError } from '../services/api';
import { SpinResult, MeResponse, RecentWinsResponse } from '../types';
import { WinModal, BetterLuckModal } from '../components/ResultModals';
import { LoadingScreen } from '../components/Common';
import { haptic } from '../hooks/useTelegramWebApp';

const SPIN_DURATION_MS = 9000;

export function WheelPage({ me, refreshMe }: { me: MeResponse; refreshMe: () => void }) {
  const [mode, setMode] = useState<'daily' | 'points'>('daily');
  const wheelRef = useRef<WheelHandle>(null);
  const [nextSpinAt, setNextSpinAt] = useState(me.wheel.nextSpinAt);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [transientPrize, setTransientPrize] = useState<PublicPrize | null>(null);
  const [pendingAnimation, setPendingAnimation] = useState<{ result: SpinResult; slotKey: string | null } | null>(null);
  const spinningRef = useRef(false);
  const deferredPrizeRefreshRef = useRef(false);
  const { label, isReady } = useCountdown(nextSpinAt);
  const canSpin = mode === 'points' ? me.user.spinPoints >= 5 : isReady;

  // If the animation from a PREVIOUS spin got interrupted (the user navigated away from
  // this tab before the 12s animation finished playing), the client never got to record
  // that spin's result or update the cooldown — the server already committed it, but this
  // page's local state never heard about it. Refreshing from the server every time this
  // page opens means that stale state can never persist past a single tab revisit, no
  // matter what happened on a previous visit.
  useEffect(() => {
    refreshMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // refreshMe() above updates the app-level `me` asynchronously — this keeps the local
  // cooldown state in sync with it once the fresh response arrives, instead of only ever
  // reflecting whatever `me` looked like at the exact moment this page first mounted.
  useEffect(() => {
    setNextSpinAt(me.wheel.nextSpinAt);
  }, [me.wheel.nextSpinAt]);

  // The exact same prize list (keys, names, icons/images) the server draws the spin
  // result from — the wheel is built from this, never a separate hardcoded copy, so it
  // can never visually show a prize/key that doesn't match what was actually won.
  const {
    data: prizes,
    error: prizesError,
    refetch: refetchPrizes,
  } = useCachedFetch<PublicPrize[]>(`wheel-prizes-${mode}`, async () => {
    const res = await api.get<{ ok: true; prizes: PublicPrize[] }>(`/wheel/prizes?mode=${mode}`);
    return res.prizes;
  });
  const {
    data: recentWins,
    refetch: refetchRecentWins,
  } = useCachedFetch<RecentWinsResponse>('wheel-recent-wins', () => api.get<RecentWinsResponse>('/wheel/recent-wins'));
  // A prize can be added by an admin after this page initially fetched its list. If that new
  // prize is awarded, retain its server-supplied card locally long enough for the pointer to
  // land on the exact key. It is never replaced by an empty/other reward card.
  const visiblePrizes = useMemo(() => {
    const items = [...(prizes ?? [])];
    const addIfMissing = (prize: PublicPrize | null) => {
      if (prize && !items.some((item) => item.key === prize.key)) items.push(prize);
    };
    if (me.wheel.lastSpin?.won && me.wheel.lastSpin.prizeKey) {
      addIfMissing({
        key: me.wheel.lastSpin.prizeKey,
        name: me.wheel.lastSpin.prizeName ?? '',
        icon: me.wheel.lastSpin.prizeIcon || '🎁',
        imageUrl: me.wheel.lastSpin.prizeImageUrl,
        isAvailable: false,
        availability: 'unavailable',
      });
    }
    addIfMissing(transientPrize);
    return items;
  }, [me.wheel.lastSpin, prizes, transientPrize]);
  const slots = useMemo(() => (prizes ? buildWheelSlots(visiblePrizes) : []), [prizes, visiblePrizes]);

   // useCachedFetch already refetches on mount. Keep subsequent stock/availability data fresh
  // on focus and at a modest interval, but defer the state update while a result is animating:
  // changing the repeated slot pattern during a spin could move the rendered pointer.
  useEffect(() => {
    const refreshWhenSafe = () => {
      if (spinningRef.current) {
        deferredPrizeRefreshRef.current = true;
        return;
      }
      void refetchPrizes().catch(() => {});
    };
    const interval = window.setInterval(refreshWhenSafe, 60_000);
    window.addEventListener('focus', refreshWhenSafe);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshWhenSafe);
    };
  }, [refetchPrizes]);

  useEffect(() => {
    const refreshRecentWins = () => {
      void refetchRecentWins().catch(() => {});
    };
    const interval = window.setInterval(refreshRecentWins, 30_000);
    window.addEventListener('focus', refreshRecentWins);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshRecentWins);
    };
  }, [refetchRecentWins]);

  // Rest the wheel on the true last result from the first render, including a historical
  // prize no longer returned by the public list.
  const initialSlotIndex =
    slots.length > 0 && me.wheel.lastSpin
      ? findSlotIndexForKey(slots, me.wheel.lastSpin.won ? me.wheel.lastSpin.prizeKey : null)
      : null;

  // State updates for a newly introduced prize must commit before the imperative animation
  // starts; otherwise an old reel could have no matching card. The null branch is a defensive
  // invariant failure, not a visual fallback to another reward.
  useEffect(() => {
    if (!pendingAnimation || !wheelRef.current) return;
    const targetSlotIndex = findSlotIndexForKey(slots, pendingAnimation.slotKey);
    if (targetSlotIndex === null || targetSlotIndex < 0) {
      setPendingAnimation(null);
      spinningRef.current = false;
      setSpinning(false);
      setError('تعذر عرض النتيجة المؤكدة. حدّث الصفحة لرؤية جائزتك في الحقيبة.');
      return;
    }
    const spinResult = pendingAnimation.result;
    setPendingAnimation(null);
    wheelRef.current.spinTo(targetSlotIndex, SPIN_DURATION_MS, () => {
      spinningRef.current = false;
      setSpinning(false);
      setResult(spinResult);
      if (mode === 'daily') setNextSpinAt(spinResult.nextSpinAt);
      haptic(spinResult.won ? 'heavy' : 'light');
      invalidateCache('inventory');
      invalidateCache('history');
      invalidateCache('notifications');
      invalidateCache(`wheel-prizes-${mode}`);
      refreshMe();
      // The prize slot set is frozen until the result is visibly settled. Refresh after that
      // so exhausted labels and admin stock edits are current without displacing the landing.
      void refetchPrizes().catch(() => {});
      void refetchRecentWins().catch(() => {});
      if (deferredPrizeRefreshRef.current) {
        deferredPrizeRefreshRef.current = false;
        void refetchPrizes().catch(() => {});
      }
    });
   }, [mode, pendingAnimation, refreshMe, refetchPrizes, refetchRecentWins, slots]);

  async function handleSpin() {
    if (spinning || !canSpin || slots.length === 0) return;
    setError(null);
    spinningRef.current = true;
    setSpinning(true);
    haptic('medium');

    try {
      const res = await api.post<{ ok: true; result: SpinResult }>(mode === 'points' ? '/points-wheel/spin' : '/wheel/spin');
      const spinResult = res.result;
      if (spinResult.won) {
        setTransientPrize({
          key: spinResult.prizeKey,
          name: spinResult.prizeName,
          icon: spinResult.prizeIcon,
          imageUrl: spinResult.prizeImageUrl,
          isAvailable: false,
          availability: 'unavailable',
        });
      }
      setPendingAnimation({ result: spinResult, slotKey: spinResult.won ? spinResult.prizeKey : null });
    } catch (err) {
      spinningRef.current = false;
      setSpinning(false);
      if (err instanceof ApiError) {
        if (err.code === 'SPIN_COOLDOWN') setError('الفرة مو جاهزة بعد.');
        else if (err.code === 'INSUFFICIENT_POINTS') setError('تحتاج 5 نقاط حتى تدور عجلة النقاط.');
        else if (err.code === 'FORCED_SUB_REQUIRED') setError('لازم تكمل الاشتراك الإجباري أولاً.');
        else if (err.code === 'CAPTCHA_REQUIRED') setError('لازم تكمل التحقق أولاً.');
        else setError('صار خطأ، حاول مرة ثانية.');
      } else {
        setError('صار خطأ، حاول مرة ثانية.');
      }
    }
  }

  return (
    <div className="wheel-page">
       <section className="wheel-hero">
        <div className="wheel-hero-heading">
          <span className="wheel-kicker">BOUNTY SPIN • MF</span>
          <h2>
            🎰 عجلة حظ باونتي <span className="brand-mf">MF</span>
          </h2>
           <p>{mode === 'daily' ? 'دورك المجاني اليومي واربح جوائز باونتي راش' : 'كل دورة تكلف 5 نقاط — جوائز عجلة النقاط مستقلة'}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14 }}>
            <button className={`pill ${mode === 'daily' ? 'pill-admin' : ''}`} onClick={() => setMode('daily')}>🎰 العجلة اليومية</button>
            <button className={`pill ${mode === 'points' ? 'pill-admin' : ''}`} onClick={() => setMode('points')}>🪙 عجلة النقاط</button>
          </div>
          {mode === 'points' && <div className="pill" style={{ justifyContent: 'center', marginTop: 10 }}>رصيدك: {me.user.spinPoints} نقطة · السعر: 5</div>}
        </div>

         {recentWins?.wins && recentWins.wins.length > 0 && (
           <div className="recent-wins-ticker" aria-label="آخر الجوائز الفائزة">
             <div className="recent-wins-track">
               {[...recentWins.wins, ...recentWins.wins].map((win, index) => (
                 <div className="recent-win" key={`${win.id}-${index}`}>
                   {win.imageUrl ? <img src={win.imageUrl} alt="" /> : <span aria-hidden="true">{win.icon || '🎁'}</span>}
                 </div>
               ))}
             </div>
           </div>
         )}

        {slots.length === 0 ? (
          prizesError ? (
            <div className="card" style={{ textAlign: 'center', marginTop: 20 }}>
              <p style={{ color: 'var(--danger)', marginTop: 0 }}>تعذر تحميل قائمة الجوائز.</p>
              <button className="btn btn-primary" onClick={() => void refetchPrizes().catch(() => {})}>
                إعادة المحاولة
              </button>
            </div>
          ) : (
            <LoadingScreen />
          )
        ) : (
          <div className={`wheel-stage ${spinning ? 'reel-pending-pulse' : ''}`}>
            <Wheel ref={wheelRef} slots={slots} initialSlotIndex={initialSlotIndex} showAvailability={me.isAdmin} />
          </div>
        )}

        <div className="wheel-controls">
          {mode === 'daily' && !isReady && !spinning && (
            <>
              <div className="countdown wheel-countdown">
                ⏳ الفرة القادمة بعد: {label}
              </div>
              {/* The reel's visual position has no memory of a past spin once this page
                  remounts — this text is the only thing that reliably shows what you actually
                  won last time. */}
              {me.wheel.lastSpin && (
                <div className="wheel-last-result">
                  {me.wheel.lastSpin.won ? (
                    <>
                      {me.wheel.lastSpin.prizeImageUrl ? (
                        <img src={me.wheel.lastSpin.prizeImageUrl} alt="" />
                      ) : (
                        <span>{me.wheel.lastSpin.prizeIcon || '🎁'}</span>
                      )}
                      <span>
                        آخر نتيجة: ربحت <b>{me.wheel.lastSpin.prizeName}</b>
                      </span>
                    </>
                  ) : (
                    <span>🍀 آخر نتيجة: حظ أوفر بالمرة الجاية</span>
                  )}
                </div>
              )}
            </>
          )}
          <button className="btn btn-primary wheel-spin-button" disabled={spinning || !canSpin || slots.length === 0} onClick={handleSpin}>
            {spinning ? '🎡 جاري الدوران...' : mode === 'points' ? canSpin ? '🪙 دور مقابل 5 نقاط' : 'تحتاج 5 نقاط' : isReady ? '🚀 دور الحين' : '⏳ انتظر الفرة'}
          </button>
          {error && <p className="wheel-error">{error}</p>}
        </div>
      </section>

      {/* Full, always-visible list of every prize currently on the wheel — the reel strip
          only shows a few cards at a time as it scrolls, so this is how a player can browse
          and confirm every prize (all of them) without waiting for a lucky spin. */}
      {prizes && prizes.length > 0 && (
        <div className="card prize-catalog" style={{ marginTop: 24 }}>
          <h3 className="card-title" style={{ marginBottom: 10 }}>
              🏆 كل الجوائز ({visiblePrizes.length})
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {visiblePrizes.map((p) => (
              <div
                key={p.key}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                  padding: '10px 6px',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--card-border)',
                }}
              >
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }} />
                ) : (
                  <div style={{ fontSize: 26 }}>{p.icon}</div>
                )}
                <div style={{ fontSize: 11, textAlign: 'center', color: 'var(--text-dim)' }}>{p.name}</div>
                {me.isAdmin && p.availability === 'out_of_stock' && (
                  <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>نفدت</div>
                )}
                {me.isAdmin && p.availability === 'unavailable' && (
                  <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>غير متاحة حالياً</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

       {result && result.won && (
        <WinModal prizeName={result.prizeName || ''} prizeKey={result.prizeKey} onClose={() => setResult(null)} />
      )}
       {result && !result.won && <BetterLuckModal onClose={() => setResult(null)} />}
    </div>
  );
}
