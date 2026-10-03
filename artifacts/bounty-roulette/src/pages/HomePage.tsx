import React, { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { MeResponse } from '../types';
import { useCountdown } from '../hooks/useCountdown';
import { TabKey } from '../components/BottomNav';
import { api } from '../services/api';
import { getLang, setLang, tr } from '../i18n';

function LanguageToggle() {
  const next = getLang() === 'ar' ? 'en' : 'ar';
  return (
    <button
      className="lang-toggle"
      onClick={() => {
        setLang(next);
        // Saved on the server too, so the bot's own messages follow the same language.
        void api.post('/me/language', { language: next }).catch(() => {});
      }}
      aria-label={tr('تغيير اللغة', 'Change language')}
    >
      🌐 {next === 'en' ? 'English' : 'العربية'}
    </button>
  );
}

export function HomePage({ me, onNavigate, onDailyLogin }: { me: MeResponse; onNavigate: (t: TabKey) => void; onDailyLogin: () => void }) {
  const { label, isReady } = useCountdown(me.wheel.nextSpinAt);
  const initial = (me.user.firstName || me.user.username || '؟').charAt(0).toUpperCase();
  const [toast, setToast] = useState<string | null>(null);

  // Developers can use the exchange while it's being tested; members get "coming soon".
  const exchangeOpen = me.isAdmin || me.exchangePublic === true;

  function comingSoon() {
    setToast(tr('🔜 قريباً! تحديث خرافي قادم… ترقّبوا 🔥', '🔜 Coming soon! Something huge is on the way… stay tuned 🔥'));
    window.setTimeout(() => setToast(null), 2500);
  }

  return (
    <div className="home-page">
      <div className="home-top-row">
        <div className="home-brand">
          <div className="home-brand-mark">🎯</div>
          <div>
            <div className="home-brand-title">{tr('روليت باونتي', 'Bounty Roulette')} <span className="brand-mf">MF</span></div>
            <div className="home-brand-subtitle">{tr('جوائزك اليومية بانتظارك', 'Your daily prizes are waiting')}</div>
          </div>
        </div>
        <LanguageToggle />
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
            <span className="home-profile-greeting">{tr('مرحباً بك 👋', 'Welcome 👋')}</span>
            <strong>
              <bdi>
                {me.user.username
                  ? `@${me.user.username} · ${me.user.firstName || tr('بدون اسم', 'No name')}`
                  : me.user.firstName || tr('صديقنا', 'friend')}
              </bdi>
            </strong>
            <span className="home-profile-caption">{tr('جاهز تجمع جوائز اليوم؟', 'Ready to collect today’s prizes?')}</span>
          </div>
          <button className="home-history-btn" onClick={() => onNavigate('history')} aria-label={tr('السجل', 'History')}>
            <ScrollText size={20} />
            <span>{tr('السجل', 'History')}</span>
          </button>
        </div>
        <div className="home-stats">
          <button className="home-stat home-stat-store" onClick={() => onNavigate('store')} title={tr('فتح المتجر', 'Open the store')}>
            <span className="home-stat-icon">🏪</span>
            <span className="home-stat-copy">
              <span>{tr('المتجر', 'Store')}</span>
              <strong>{me.user.spinCredits} <small>{tr('فرة', 'spins')}</small></strong>
            </span>
            <span className="home-stat-arrow">←</span>
          </button>
          <button className="home-stat home-stat-spins" onClick={() => onNavigate('store')} title={tr('فتح المتجر', 'Open the store')}>
            <span className="home-stat-icon">🎰</span>
            <span className="home-stat-copy">
              <span>{tr('نقاط عجلة النقاط', 'Points-wheel points')}</span>
              <strong>{me.user.spinPoints}</strong>
            </span>
            <span className="home-stat-arrow">←</span>
          </button>
        </div>
      </section>

      <button className="home-exchange-card" onClick={exchangeOpen ? () => onNavigate('exchange') : comingSoon}>
        <span className="home-exchange-shade" />
        <span className="home-exchange-copy">
          <span className="home-section-label">{tr('🔄 قسم التبادل', '🔄 Exchange')}</span>
          <strong>{tr('بدّل أو بِع حسابك في باونتي راش', 'Trade or sell your Bounty Rush account')}</strong>
          <span>{tr('بأمان وبسهولة مع وسطاء MF', 'Safely and easily with MF middlemen')}</span>
        </span>
        {exchangeOpen ? <span className="exchange-soon-pill">{tr('ادخل ←', 'Enter →')}</span> : <span className="exchange-soon-pill">{tr('قريباً', 'Soon')}</span>}
      </button>

      <button className="home-spin-card" onClick={() => onNavigate('wheel')}>
        <div className="home-spin-art" aria-hidden="true">🎡</div>
        <div className="home-spin-content">
          <span className="home-section-label">{tr('الفرصة اليومية', 'Daily chance')}</span>
          <h2>{tr('الفرة المجانية 🎰', 'Free spin 🎰')}</h2>
          <p>{tr('دور كل يوم واربح جوائز', 'Spin every day and win prizes')}</p>
          <div className="home-spin-status">
            {isReady ? (
              <span className="home-ready">{tr('✅ الفرة جاهزة الآن', '✅ Your spin is ready')}</span>
            ) : (
              <span className="home-countdown">⏳ {tr('متبقي:', 'Next in:')} {label}</span>
            )}
          </div>
        </div>
      </button>

      {/* Quick sections, each with its own artwork. */}
      <div className="home-tiles">
        <button className="art-tile" onClick={onDailyLogin}>
          <span className="art-bg" style={{ backgroundImage: 'url(/art/daily.svg)' }} />
          <span className="art-shade" />
          <span className="art-tile-icon">🔥</span>
          <strong>{tr('الدخول اليومي', 'Daily login')}</strong>
          <small>{tr('جائزة كل 24 ساعة', 'A reward every 24h')}</small>
        </button>
        <button className="art-tile" onClick={() => onNavigate('tasks')}>
          <span className="art-bg" style={{ backgroundImage: 'url(/art/tasks.svg)' }} />
          <span className="art-shade" />
          <span className="art-tile-icon">🎯</span>
          <strong>{tr('المهام', 'Tasks')}</strong>
          <small>{tr('إعلانات ومهام بنقاط', 'Ads & tasks for points')}</small>
        </button>
        <button className="art-tile" onClick={() => onNavigate('inventory')}>
          <span className="art-bg" style={{ backgroundImage: 'url(/art/inventory.svg)' }} />
          <span className="art-shade" />
          <span className="art-tile-icon">🎒</span>
          <strong>{tr('المخزون', 'Inventory')}</strong>
          <small>{tr('جوائزك واستلامها', 'Your prizes')}</small>
        </button>
        <button className="art-tile" onClick={() => onNavigate('store')}>
          <span className="art-bg" style={{ backgroundImage: 'url(/art/store.svg)' }} />
          <span className="art-shade" />
          <span className="art-tile-icon">🏪</span>
          <strong>{tr('المتجر', 'Store')}</strong>
          <small>{tr('بدّل فرّاتك بجوائز', 'Swap spins for prizes')}</small>
        </button>
      </div>

      <button className="art-card" onClick={() => onNavigate('games')}>
        <span className="art-bg" style={{ backgroundImage: 'url(/art/games.svg)' }} />
        <span className="art-shade" />
        <span className="home-section-label">{tr('🎮 قسم الألعاب', '🎮 Games')}</span>
        <strong>{tr('العب واربح نقاط', 'Play and earn points')}</strong>
        <span className="art-card-sub">{tr('لعبة الحية، وألعاب جديدة جاية قريباً', 'Snake, with new games coming soon')}</span>
        <span className="art-card-pill">{tr('ادخل ←', 'Enter →')}</span>
      </button>

      {me.contestEnabled !== false && (
        <button className="home-contest-card" onClick={() => onNavigate('contest')}>
          <img src="/nft-santa-hat.jpg" alt="" className="home-contest-art" />
          <span className="home-contest-copy">
            <span className="home-section-label">{tr('🏆 سباق الدعوات', '🏆 Invite race')}</span>
            <strong>{tr('اربح Santa Hat NFT', 'Win a Santa Hat NFT')}</strong>
            <span>{tr('تصدّر قائمة الدعوات واربح الهدية', 'Top the invite leaderboard and win the gift')}</span>
          </span>
          <span className="home-link-arrow">←</span>
        </button>
      )}

      {/* Delivery proofs from the official channel, shown inside the app. */}
      <button className="art-card" onClick={() => onNavigate('proofs')}>
        <span className="art-bg" style={{ backgroundImage: 'url(/art/proofs.svg)' }} />
        <span className="art-shade" />
        <span className="home-section-label">{tr('🏆 قناة الإثباتات', '🏆 Proofs channel')}</span>
        <strong>{tr('شوف الجوائز اللي تسلّمت', 'See the prizes we delivered')}</strong>
        <span className="art-card-sub">{tr('صور حقيقية لتسليم الجوائز للفائزين', 'Real photos of prizes handed to winners')}</span>
      </button>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
