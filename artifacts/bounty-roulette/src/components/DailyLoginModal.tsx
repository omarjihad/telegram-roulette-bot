import React, { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { DailyLoginResponse, DailyLoginStatusResponse } from '../types';
import { ApiError } from '../services/api';
import { haptic } from '../hooks/useTelegramWebApp';

function rewardDays() {
  return [
    { day: 1, label: tr('0.5 نقطة', '0.5 pts'), icon: '🪙' },
    { day: 2, label: tr('1 نقطة', '1 pt'), icon: '🪙' },
    { day: 3, label: tr('2 نقطة', '2 pts'), icon: '🪙' },
    { day: 4, label: tr('3 نقاط', '3 pts'), icon: '🪙' },
    { day: 5, label: tr('حساب 3000 جوهرة', '3000-gem account'), icon: '💎' },
    { day: 6, label: tr('5 نقاط', '5 pts'), icon: '🪙' },
    { day: 7, label: tr('حساب 5000 جوهرة', '5000-gem account'), icon: '💎' },
  ];
}

type Status = DailyLoginStatusResponse['status'];
type Result = DailyLoginResponse['result'];

function useRemaining(target: string | null) {
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    if (!target) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((new Date(target).getTime() - Date.now()) / 1000));
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      setRemaining(tr(`${h}س ${m}د ${s}ث`, `${h}h ${m}m ${s}s`));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [target]);
  return remaining;
}

function rewardLabel(reward: Result['reward']) {
  if (reward.type === 'points') return tr(`${reward.points} نقطة`, `${reward.points} pts`);
  return reward.prizeName ?? tr('جائزة', 'Prize');
}

export function DailyLoginModal({
  status,
  onCollect,
  onClose,
}: {
  status: Status;
  onCollect: () => Promise<Result>;
  onClose: () => void;
}) {
  const [collected, setCollected] = useState<Result | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCollect = status.canClaim && !collected;
  const streakDay = collected?.streakDay ?? status.streakDay;
  const claimedDays = collected?.claimedDays ?? status.claimedDays;
  const nextClaimAt = collected ? collected.nextClaimAt : status.canClaim ? null : status.nextClaimAt;
  const remaining = useRemaining(nextClaimAt);

  async function collect() {
    if (collecting) return;
    setCollecting(true);
    setError(null);
    try {
      const result = await onCollect();
      setCollected(result);
      haptic('medium');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr('صار خطأ، حاول مرة ثانية.', 'Something went wrong, please try again.'));
    } finally {
      setCollecting(false);
    }
  }

  let subtitle: string;
  if (collected) subtitle = tr(`✅ استلمت جائزة اليوم ${collected.streakDay}: ${rewardLabel(collected.reward)}`, `✅ Collected day ${collected.streakDay}: ${rewardLabel(collected.reward)}`);
  else if (canCollect && status.streakReset) subtitle = tr('فاتك يوم، فالستريك رجع من البداية 😢 اجمع اليوم 1 وابدأ من جديد', 'You missed a day, so your streak restarted 😢 Collect day 1 and start again');
  else if (canCollect) subtitle = tr(`جائزة اليوم ${status.streakDay} جاهزة، اضغط جمع حتى تستلمها`, `Day ${status.streakDay} reward is ready — tap collect`);
  else subtitle = tr(`ستريك ${status.streakDay} من 7 — جمعت جائزة اليوم`, `Streak ${status.streakDay} of 7 — today’s reward collected`);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div style={{ fontSize: 38 }}>🔥</div>
        <h2 style={{ margin: '4px 0' }}>{tr('تسجيل الدخول اليومي', 'Daily login')}</h2>
        <p className="card-sub" style={{ marginTop: 6, lineHeight: 1.6 }}>{subtitle}</p>
        <div className="daily-grid">
          {rewardDays().map((item) => {
            const claimed = claimedDays.includes(item.day);
            const active = item.day === streakDay;
            const ready = active && canCollect;
            return (
              <div
                key={item.day}
                className={`daily-day ${claimed ? 'daily-day-claimed' : ''} ${active ? 'daily-day-active' : ''} ${ready ? 'daily-day-ready' : ''}`}
              >
                <div style={{ fontSize: 20 }}>{claimed ? '✅' : item.icon}</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{tr(`اليوم ${item.day}`, `Day ${item.day}`)}</div>
                <div style={{ fontSize: 10, fontWeight: 800, marginTop: 3 }}>{item.label}</div>
              </div>
            );
          })}
        </div>

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 10px' }}>{error}</p>}

        {canCollect ? (
          <button className="btn btn-primary daily-collect" onClick={collect} disabled={collecting}>
            {collecting ? tr('جاري الجمع...', 'Collecting...') : tr(`🎁 جمع (${rewardLabel(status.reward)})`, `🎁 Collect (${rewardLabel(status.reward)})`)}
          </button>
        ) : (
          <>
            {nextClaimAt && <div className="countdown">{tr('الجائزة القادمة بعد', 'Next reward in')} {remaining}</div>}
            <p className="card-sub" style={{ fontSize: 12, marginTop: 10 }}>
              {tr('⚠️ إذا فوّتت يوم كامل بدون جمع، الستريك يرجع من البداية.', '⚠️ Miss a whole day without collecting and your streak restarts.')}
            </p>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={onClose}>{tr('حسناً', 'OK')}</button>
          </>
        )}
      </div>
    </div>
  );
}
