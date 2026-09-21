import React, { useEffect, useState } from 'react';
import { DailyLoginResponse } from '../types';

const rewards = [
  { day: 1, label: '0.5 نقطة', icon: '🪙' },
  { day: 2, label: '1 نقطة', icon: '🪙' },
  { day: 3, label: '2 نقطة', icon: '🪙' },
  { day: 4, label: '3 نقاط', icon: '🪙' },
  { day: 5, label: 'حساب 3000 جوهرة', icon: '💎' },
  { day: 6, label: '5 نقاط', icon: '🪙' },
  { day: 7, label: 'حساب 5000 جوهرة', icon: '💎' },
];

export function DailyLoginModal({ data, onClose }: { data: DailyLoginResponse['result']; onClose: () => void }) {
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((new Date(data.nextClaimAt).getTime() - Date.now()) / 1000));
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      setRemaining(`${h}س ${m}د ${s}ث`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [data.nextClaimAt]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()} dir="rtl">
        <div style={{ fontSize: 38 }}>🔥</div>
        <h2 style={{ margin: '4px 0' }}>تسجيل الدخول اليومي</h2>
        <p className="card-sub" style={{ marginTop: 6 }}>
          ستريك {data.streakDay} من 7 — {data.alreadyClaimed ? 'تم تسجيل دخولك اليوم' : 'تمت إضافة جائزتك'}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, margin: '18px 0' }}>
          {rewards.map((item) => {
            const claimed = data.claimedDays.includes(item.day);
            const active = item.day === data.streakDay;
            return (
              <div key={item.day} style={{ padding: '9px 4px', borderRadius: 12, textAlign: 'center', border: active ? '2px solid var(--accent)' : '1px solid var(--card-border)', background: claimed ? 'rgba(40, 180, 110, .16)' : 'rgba(255,255,255,.04)' }}>
                <div style={{ fontSize: 20 }}>{claimed ? '✅' : item.icon}</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>اليوم {item.day}</div>
                <div style={{ fontSize: 10, fontWeight: 800, marginTop: 3 }}>{item.label}</div>
                {claimed && <div style={{ fontSize: 9, color: '#6ee7a8', marginTop: 3 }}>Claimed</div>}
              </div>
            );
          })}
        </div>
        {data.alreadyClaimed && <div className="countdown">الجائزة القادمة بعد {remaining}</div>}
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={onClose}>حسناً</button>
      </div>
    </div>
  );
}