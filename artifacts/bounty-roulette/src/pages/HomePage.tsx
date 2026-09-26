import React from 'react';
import { MeResponse } from '../types';
import { useCountdown } from '../hooks/useCountdown';
import { TabKey } from '../components/BottomNav';

export function HomePage({ me, onNavigate, onDailyLogin }: { me: MeResponse; onNavigate: (t: TabKey) => void; onDailyLogin: () => void }) {
  const { label, isReady } = useCountdown(me.wheel.nextSpinAt);
  const initial = (me.user.firstName || me.user.username || '؟').charAt(0).toUpperCase();

  return (
    <div className="home-page">
      <div className="home-brand">
        <div className="home-brand-mark">🎯</div>
        <div>
          <div className="home-brand-title">روليت باونتي <span className="brand-mf">MF</span></div>
          <div className="home-brand-subtitle">جوائزك اليومية بانتظارك</div>
        </div>
      </div>

      <section className="home-profile-card">
        <div className="home-profile">
          {me.user.photoUrl ? (
            <img
              src={me.user.photoUrl}
              alt=""
              className="home-avatar"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
                e.currentTarget.nextElementSibling?.classList.remove('avatar-fallback-hidden');
              }}
            />
          ) : null}
          <div className={`home-avatar home-avatar-fallback ${me.user.photoUrl ? 'avatar-fallback-hidden' : ''}`}>{initial}</div>
          <div className="home-profile-copy">
            <span className="home-profile-greeting">مرحباً بك 👋</span>
            <strong>{me.user.username ? `@${me.user.username} · ${me.user.firstName || 'بدون اسم'}` : me.user.firstName || 'صديقنا'}</strong>
            <span className="home-profile-caption">جاهز تجمع جوائز اليوم؟</span>
          </div>
        </div>
        <div className="home-stats">
          <button className="home-stat home-stat-store" onClick={() => onNavigate('store')} title="فتح المتجر">
            <span className="home-stat-icon">🏪</span>
            <span className="home-stat-copy">
              <span>المتجر</span>
              <strong>{me.user.spinCredits} <small>فرة</small></strong>
            </span>
            <span className="home-stat-arrow">←</span>
          </button>
          <button className="home-stat home-stat-spins" onClick={() => onNavigate('store')} title="فتح المتجر">
            <span className="home-stat-icon">🎰</span>
            <span className="home-stat-copy">
            <span>نقاط عجلة النقاط</span>
            <strong>{me.user.spinPoints}</strong>
            </span>
            <span className="home-stat-arrow">←</span>
          </button>
        </div>
      </section>

      <button className="home-spin-card" onClick={() => onNavigate('wheel')}>
        <div className="home-spin-art" aria-hidden="true">🎡</div>
        <div className="home-spin-content">
          <span className="home-section-label">الفرصة اليومية</span>
          <h2>الفرة المجانية 🎰</h2>
          <p>دور كل يوم واربح جوائز</p>
          <div className="home-spin-status">
            {isReady ? (
              <span className="home-ready">✅ الفرة جاهزة الآن</span>
            ) : (
              <span className="home-countdown">⏳ متبقي: {label}</span>
            )}
          </div>
        </div>
      </button>

      <button className="home-contest-card" onClick={() => onNavigate('contest')}>
        <img src="/nft-santa-hat.jpg" alt="" className="home-contest-art" />
        <span className="home-contest-copy">
          <span className="home-section-label">🏆 سباق الدعوات</span>
          <strong>اربح Santa Hat NFT</strong>
          <span>تصدّر قائمة الدعوات واربح الهدية</span>
        </span>
        <span className="home-link-arrow">←</span>
      </button>

      <button className="home-link-card home-link-daily" onClick={onDailyLogin}>
        <span className="home-link-icon">🔥</span>
        <span className="home-link-copy">
          <strong>تسجيل الدخول اليومي</strong>
          <span>استلم جائزتك كل 24 ساعة وحافظ على الستريك</span>
        </span>
        <span className="home-link-arrow">←</span>
      </button>

      <button className="home-link-card home-link-tasks" onClick={() => onNavigate('tasks')}>
        <span className="home-link-icon">🎯</span>
        <span className="home-link-copy">
          <strong>المهام والإحالات</strong>
          <span>ادعُ أصدقاءك واحصل على مكافآت إضافية</span>
        </span>
        <span className="home-link-arrow">←</span>
      </button>

      <button className="home-link-card home-link-inventory" onClick={() => onNavigate('inventory')}>
        <span className="home-link-icon">🎒</span>
        <span className="home-link-copy">
          <strong>المخزون</strong>
          <span>شوف جوائزك واستلمها قبل ما تنتهي</span>
        </span>
        <span className="home-link-arrow">←</span>
      </button>
    </div>
  );
}