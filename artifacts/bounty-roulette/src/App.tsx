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
import { StorePage } from './pages/StorePage';
import { ContestPage } from './pages/ContestPage';
import { ShowcasePage } from './pages/ShowcasePage';
import { DailyLoginModal } from './components/DailyLoginModal';

type Stage = 'loading' | 'forced_sub' | 'captcha' | 'ready' | 'error' | 'showcase';

// The race section link (startapp=race), race invite links (startapp=race_<token>) and the
// bot's "enter the race" button (?tab=race) all open the app straight on the race tab.
function initialTab(): TabKey {
  const tg = getTelegramWebApp() as { initDataUnsafe?: { start_param?: string } } | null;
  const startParam = tg?.initDataUnsafe?.start_param ?? '';
  const urlTab = new URLSearchParams(window.location.search).get('tab');
  if (startParam === 'race' || startParam.startsWith('race_') || urlTab === 'race') return 'contest';
  return 'home';
}

export default function App() {
  const { ready: tgReady } = useTelegramWebApp();
  const [stage, setStage] = useState<Stage>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tab, setTab] = useState<TabKey>(initialTab);
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
    const daily = await api.post<DailyLoginResponse>('/daily-login');
    setMe((current) => current ? { ...current, user: { ...current.user, spinPoints: daily.result.spinPoints, spinCredits: daily.result.spinCredits } } : current);
    return daily.result;
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const initData = getTelegramWebApp()?.initData;
      if (!initData) {
        setStage('showcase');
        return;
      }
      const res = await api.get<MeResponse>('/me');
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
        setErrorMsg(err.message || 'التطبيق في وضع المعاينة.');
      } else {
        setErrorMsg(err instanceof Error && 'code' in err ? err.message : 'تعذر الاتصال بالخادم. تأكد إنك فاتح البوت من داخل تيليجرام.');
      }
      setStage('error');
    }
  }, [openDailyLogin]);

  useEffect(() => {
    if (tgReady) loadMe();
  }, [tgReady, loadMe]);

  // A stopped race is hidden: links or taps that land on its tab fall back to home.
  useEffect(() => {
    if (me && me.contestEnabled === false && tab === 'contest') setTab('home');
  }, [me, tab]);

  if (stage === 'loading' || !tgReady) return <LoadingScreen label="جاري التحضير..." />;

  if (stage === 'showcase') {
    return <ShowcasePage />;
  }

  if (stage === 'error') {
    return (
      <div className="app-shell">
        <div className="app-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 20 }}>
          <img src="/logo-skull.png" alt="Skull" style={{ width: 120, filter: 'drop-shadow(0 0 20px rgba(243, 198, 35, 0.4))' }} />
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)' }}>عذراً!</div>
          <p style={{ textAlign: 'center', fontSize: 16, lineHeight: 1.6, color: 'var(--text-main)', background: 'rgba(0,0,0,0.5)', padding: '16px', borderRadius: 12, border: '1px solid var(--danger)' }}>
            {errorMsg}
          </p>
          <button className="btn btn-primary" onClick={loadMe}>إعادة المحاولة</button>
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

  if (showAdmin) return <AdminPage onClose={() => setShowAdmin(false)} />;

  return (
    <div className="app-shell">
      <div className="app-content">
        {dailyLogin && <DailyLoginModal status={dailyLogin} onCollect={collectDailyLogin} onClose={() => setDailyLogin(null)} />}
        {me.isAdmin && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button
              className="pill pill-admin"
              style={{ cursor: 'pointer', border: '1px solid var(--accent)' }}
              onClick={() => setShowAdmin(true)}
            >
              لوحة المطور 👑
            </button>
          </div>
        )}
        <div className="page-enter" key={tab}>
        {tab === 'home' && <HomePage me={me} onNavigate={setTab} onDailyLogin={() => void openDailyLogin(false).catch(() => {})} />}
        {tab === 'wheel' && <WheelPage me={me} refreshMe={loadMe} />}
        {tab === 'tasks' && <TasksPage />}
        {tab === 'contest' && contestOn && <ContestPage />}
        {tab === 'inventory' && <InventoryPage />}
        {tab === 'history' && <HistoryPage />}
        {tab === 'store' && (
          <StorePage spinCredits={me.user.spinCredits} onBack={() => setTab('home')} refreshMe={loadMe} />
        )}
        </div>
      </div>
      <BottomNav active={tab} onChange={setTab} hideContest={!contestOn} />
    </div>
  );
}
