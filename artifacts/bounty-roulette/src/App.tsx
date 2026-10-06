import React, { useCallback, useEffect, useState } from 'react';
import { useTelegramWebApp, getTelegramWebApp } from './hooks/useTelegramWebApp';
import { api } from './services/api';
import { DailyLoginResponse, DailyLoginStatusResponse, MeResponse } from './types';
import { LoadingScreen } from './components/Common';
import { CaptchaGate } from './components/CaptchaGate';
import { ForcedSubGate } from './components/ForcedSubGate';
import { BottomNav, TabKey } from './components/BottomNav';
import { HomePage } from './pages/HomePage';
import { WheelPage } from './pages/WheelPage';
import { TasksPage } from './pages/TasksPage';
import { InventoryPage } from './pages/InventoryPage';
import { HistoryPage } from './pages/HistoryPage';
import { AdminPage } from './pages/AdminPage';
import { ContestPage } from './pages/ContestPage';
import { GamesPage } from './pages/GamesPage';
import { ReferralsPage } from './pages/ReferralsPage';
import { ExchangePage } from './pages/ExchangePage';
import { ProofsPage } from './pages/ProofsPage';
import { ZigguratPage } from './pages/ZigguratPage';
import { GamesHubPage } from './pages/GamesHubPage';
import { PreviewBanner } from './components/PreviewBanner';
import { hasStoredLang, setLang, tr, useLang } from './i18n';
import { isPreviewMode } from './services/preview';
import { clearCache } from './hooks/useCachedFetch';
import { DailyLoginModal } from './components/DailyLoginModal';
import { adErrorMessage } from './components/AdTaskCard';
import { claimAfterAd, showRewardedAd } from './services/adsgram';

type Stage = 'loading' | 'forced_sub' | 'captcha' | 'ready' | 'error';

// The race section link (startapp=race), race invite links (startapp=race_<token>) and the
// bot's "enter the race" button (?tab=race) all open the app straight on the race tab.
function initialTab(): TabKey {
  const tg = getTelegramWebApp() as { initDataUnsafe?: { start_param?: string } } | null;
  const startParam = tg?.initDataUnsafe?.start_param ?? '';
  const urlTab = new URLSearchParams(window.location.search).get('tab');
  if (startParam === 'race' || startParam.startsWith('race_') || urlTab === 'race') return 'contest';
  if (initialListingId() || initialOfferId() || urlTab === 'exchange') return 'exchange';
  if (startParam === 'proofs' || urlTab === 'proofs') return 'proofs';
  return 'home';
}

// "Request a middleman" under an accepted offer: startapp=mo_<offerId>, or ?mo=<offerId>.
function initialOfferId(): string | null {
  const tg = getTelegramWebApp() as { initDataUnsafe?: { start_param?: string } } | null;
  const startParam = tg?.initDataUnsafe?.start_param ?? '';
  const id = startParam.startsWith('mo_') ? startParam.slice(3) : new URLSearchParams(window.location.search).get('mo');
  return id && /^[a-f0-9]{24}$/.test(id) ? id : null;
}

// Exchange post links: startapp=listing_<id>, or ?tab=exchange&listing=<id> from the bot's button.
function initialListingId(): string | null {
  const tg = getTelegramWebApp() as { initDataUnsafe?: { start_param?: string } } | null;
  const startParam = tg?.initDataUnsafe?.start_param ?? '';
  const id = startParam.startsWith('listing_') ? startParam.slice('listing_'.length) : new URLSearchParams(window.location.search).get('listing');
  return id && /^[a-f0-9]{24}$/.test(id) ? id : null;
}

export default function App() {
  const { ready: tgReady } = useTelegramWebApp();
  // Re-render the whole app when the language changes.
  const { lang } = useLang();
  const preview = isPreviewMode();
  const [stage, setStage] = useState<Stage>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [listingLink, setListingLink] = useState(initialListingId);
  const [offerLink, setOfferLink] = useState(initialOfferId);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [dailyLogin, setDailyLogin] = useState<DailyLoginStatusResponse['status'] | null>(null);

  // Opening the app only reads the daily state; the reward is collected when the user
  // presses the collect button in the modal.
  const openDailyLogin = useCallback(async (onlyIfClaimable = false) => {
    const res = await api.get<DailyLoginStatusResponse>('/daily-login');
    if (!onlyIfClaimable || res.status.canClaim) setDailyLogin(res.status);
  }, []);

  const collectDailyLogin = useCallback(async () => {
    // Prize days (5 and 7) open after an ad watched to the end.
    const blockId = me?.ads?.blockId;
    let daily: DailyLoginResponse;
    if (dailyLogin?.canClaim && dailyLogin.reward.adRequired && blockId) {
      try {
        await showRewardedAd(blockId);
        daily = await claimAfterAd<DailyLoginResponse>('/daily-login');
      } catch (err) {
        throw new Error(adErrorMessage(err));
      }
    } else {
      daily = await api.post<DailyLoginResponse>('/daily-login');
    }
    setMe((current) => current ? { ...current, user: { ...current.user, spinPoints: daily.result.spinPoints, spinCredits: daily.result.spinCredits } } : current);
    return daily.result;
  }, [dailyLogin, me?.ads?.blockId]);

  const loadMe = useCallback(async () => {
    try {
      const res = await api.get<MeResponse>('/me');
      // The language saved on the server applies until this device picks one itself.
      if (!hasStoredLang() && (res.language === 'en' || res.language === 'ar')) setLang(res.language);
      setMe(res);
      if (!res.user.forcedSubOk) setStage('forced_sub');
      else if (!res.user.captchaPassed) setStage('captcha');
      else {
        setStage('ready');
        try {
          await openDailyLogin(true);
        } catch {
          // Daily reward availability must never block the app itself.
        }
      }
    } catch (err: any) {
      if (err.status === 503) {
        setErrorMsg(err.message || tr('التطبيق في وضع المعاينة.', 'The app is in preview mode.'));
      } else {
        setErrorMsg(err instanceof Error && 'code' in err ? err.message : tr('تعذر الاتصال بالخادم. تأكد أنك فتحت البوت من داخل تيليجرام.', 'Could not reach the server. Make sure you opened the bot inside Telegram.'));
      }
      setStage('error');
    }
  }, [openDailyLogin]);

  useEffect(() => {
    if (tgReady) loadMe();
  }, [tgReady, loadMe]);

  // Data that came back in the old language (sample data on the website, the server's own
  // texts in the app) is fetched again after switching languages.
  useEffect(() => {
    if (stage !== 'ready') return;
    clearCache();
    void loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // A stopped race is hidden: links or taps that land on its tab fall back to home.
  useEffect(() => {
    if (me && me.contestEnabled === false && tab === 'contest') setTab('home');
  }, [me, tab]);

  if (stage === 'loading' || !tgReady) return <LoadingScreen label={tr('جاري التحضير...', 'Getting ready...')} />;

  if (stage === 'error') {
    return (
      <div className="app-shell">
        <div className="app-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 20 }}>
          <img src="/logo-skull.png" alt="Skull" style={{ width: 120, filter: 'drop-shadow(0 0 20px rgba(243, 198, 35, 0.4))' }} />
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)' }}>{tr('عذراً!', 'Sorry!')}</div>
          <p style={{ textAlign: 'center', fontSize: 16, lineHeight: 1.6, color: 'var(--text-main)', background: 'rgba(0,0,0,0.5)', padding: '16px', borderRadius: 12, border: '1px solid var(--danger)' }}>
            {errorMsg}
          </p>
          <button className="btn btn-primary" onClick={loadMe}>{tr('إعادة المحاولة', 'Try again')}</button>
        </div>
      </div>
    );
  }

  if (stage === 'forced_sub') {
    return <ForcedSubGate onPassed={loadMe} />;
  }

  if (stage === 'captcha') {
    return <CaptchaGate onPassed={loadMe} />;
  }

  if (!me) return <LoadingScreen />;
  const contestOn = me.contestEnabled !== false;

  // The developer panel stays in Arabic, right-to-left, whatever the user's language.
  if (showAdmin) return <div className="admin-rtl" dir="rtl"><AdminPage onClose={() => setShowAdmin(false)} /></div>;

  return (
    <div className="app-shell">
      <div className="app-content">
        {preview && <PreviewBanner />}
        {dailyLogin && <DailyLoginModal status={dailyLogin} adsOn={Boolean(me?.ads?.blockId)} onCollect={collectDailyLogin} onClose={() => setDailyLogin(null)} />}
        {me.isAdmin && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button
              className="pill pill-admin"
              style={{ cursor: 'pointer', border: '1px solid var(--accent)' }}
              onClick={() => setShowAdmin(true)}
            >
              {tr('لوحة المطور 👑', 'Developer panel 👑')}
            </button>
          </div>
        )}
        <div className="page-enter" key={tab}>
        {tab === 'home' && <HomePage me={me} onNavigate={setTab} onDailyLogin={() => void openDailyLogin(false).catch(() => {})} />}
        {tab === 'wheel' && <WheelPage me={me} refreshMe={loadMe} />}
        {tab === 'tasks' && <TasksPage refreshMe={loadMe} />}
        {tab === 'referrals' && <ReferralsPage />}
        {tab === 'contest' && contestOn && <ContestPage />}
        {tab === 'proofs' && <ProofsPage onBack={() => setTab('home')} isAdmin={me.isAdmin} />}
        {tab === 'games' && (
          <GamesHubPage onBack={() => setTab('home')} onOpenSnake={() => setTab('snake')} onOpenZiggurat={() => setTab('ziggurat')} snakeLocked={me.gamesPublic === false && !me.isAdmin} />
        )}
        {tab === 'snake' && <GamesPage onBack={() => setTab('games')} refreshMe={loadMe} />}
        {tab === 'ziggurat' && <ZigguratPage onBack={() => setTab('games')} refreshMe={loadMe} />}
        {tab === 'exchange' && <ExchangePage onBack={() => { setListingLink(null); setOfferLink(null); setTab('home'); }} initialListingId={listingLink} initialOfferId={offerLink} />}
        {tab === 'inventory' && <InventoryPage />}
        {tab === 'history' && (
          <>
            <div className="header-row" style={{ marginBottom: 12 }}>
              <span />
              <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => setTab('home')}>{tr('رجوع', 'Back')}</button>
            </div>
            <HistoryPage />
          </>
        )}
        </div>
      </div>
      {/* The exchange section has its own bottom tabs. */}
      {tab !== 'exchange' && <BottomNav active={tab} onChange={setTab} hideContest={!contestOn} />}
    </div>
  );
}
