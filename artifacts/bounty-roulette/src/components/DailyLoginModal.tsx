import React, { useEffect, useState } from 'react';
import { DailyLoginResponse, DailyLoginStatusResponse } from '../types';
import { ApiError } from '../services/api';
import { haptic } from '../hooks/useTelegramWebApp';

const rewards = [
  { day: 1, label: '0.5 نقطة', icon: '🪙' },
  { day: 2, label: '1 نقطة', icon: '🪙' },
  { day: 3, label: '2 نقطة', icon: '🪙' },
  { day: 4, label: '3 نقاط', icon: '🪙' },
  { day: 5, label: 'حساب 3000 جوهرة', icon: '💎' },
  { day: 6, label: '5 نقاط', icon: '🪙' },
  { day: 7, label: 'حساب 5000 جوهرة', icon: '💎' },
];

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
      setRemaining(`${h}س ${m}د ${s}ث`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [target]);
  return remaining;
}

function rewardLabel(reward: Result['reward']) {
  if (reward.type === 'points') return `${reward.points} نقطة`;
  return reward.prizeName ?? 'جائزة';
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
      setError(err instanceof ApiError ? err.message : 'صار خطأ، حاول مرة ثانية.');
    } finally {
      setCollecting(false);
    }
  }

  let subtitle: string;
  if (collected) subtitle = `✅ استلمت جائزة اليوم ${collected.streakDay}: ${rewardLabel(collected.reward)}`;
  else if (canCollect && status.streakReset) subtitle = 'فاتك يوم، فالستريك رجع من البداية 😢 اجمع اليوم 1 وابدأ من جديد';
  else if (canCollect) subtitle = `جائزة اليوم ${status.streakDay} جاهزة، اضغط جمع حتى تستلمها`;
  else subtitle = `ستريك ${status.streakDay} من 7 — جمعت جائزة اليوم`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()} dir="rtl">
        <div style={{ fontSize: 38 }}>🔥</div>
        <h2 style={{ margin: '4px 0' }}>تسجيل الدخول اليومي</h2>
        <p className="card-sub" style={{ marginTop: 6, lineHeight: 1.6 }}>{subtitle}</p>
        <div className="daily-grid">
          {rewards.map((item) => {
            const claimed = claimedDays.includes(item.day);
            const active = item.day === streakDay;
            const ready = active && canCollect;
            return (
              <div
                key={item.day}
                className={`daily-day ${claimed ? 'daily-day-claimed' : ''} ${active ? 'daily-day-active' : ''} ${ready ? 'daily-day-ready' : ''}`}
              >
                <div style={{ fontSize: 20 }}>{claimed ? '✅' : item.icon}</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>اليوم {item.day}</div>
                <div style={{ fontSize: 10, fontWeight: 800, marginTop: 3 }}>{item.label}</div>
              </div>
            );
          })}
        </div>

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 10px' }}>{error}</p>}

        {canCollect ? (
          <button className="btn btn-primary daily-collect" onClick={collect} disabled={collecting}>
            {collecting ? 'جاري الجمع...' : `🎁 جمع (${rewardLabel(status.reward)})`}
          </button>
        ) : (
          <>
            {nextClaimAt && <div className="countdown">الجائزة القادمة بعد {remaining}</div>}
            <p className="card-sub" style={{ fontSize: 12, marginTop: 10 }}>
              ⚠️ إذا فوّتت يوم كامل بدون جمع، الستريك يرجع من البداية.
            </p>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={onClose}>حسناً</button>
          </>
        )}
      </div>
    </div>
  );
}
