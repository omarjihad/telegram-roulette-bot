import React, { useCallback, useEffect, useState } from 'react';
import { useTelegramWebApp, getTelegramWebApp } from './hooks/useTelegramWebApp';
import { api } from './services/api';
import { DailyLoginResponse, MeResponse } from './types';
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
import { ShowcasePage } from './pages/ShowcasePage';
import { DailyLoginModal } from './components/DailyLoginModal';

type Stage = 'loading' | 'forced_sub' | 'captcha' | 'ready' | 'error' | 'showcase';

export default function App() {
  const { ready: tgReady } = useTelegramWebApp();
  const [stage, setStage] = useState<Stage>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tab, setTab] = useState<TabKey>('home');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [dailyLogin, setDailyLogin] = useState<DailyLoginResponse['result'] | null>(null);

  const claimDailyLogin = useCallback(async (showAlreadyClaimed = false) => {
    const daily = await api.post<DailyLoginResponse>('/daily-login');
    if (!daily.result.alreadyClaimed || showAlreadyClaimed) setDailyLogin(daily.result);
    setMe((current) => current ? { ...current, user: { ...current.user, spinPoints: daily.result.spinPoints, spinCredits: daily.result.spinCredits } } : current);
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
          await claimDailyLogin(false);
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
  }, [claimDailyLogin]);

  useEffect(() => {
    if (tgReady) loadMe();
  }, [tgReady, loadMe]);

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

  if (showAdmin) return <AdminPage onClose={() => setShowAdmin(false)} />;

  return (
    <div className="app-shell">
      <div className="app-content">
        {dailyLogin && <DailyLoginModal data={dailyLogin} onClose={() => setDailyLogin(null)} />}
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
        {tab === 'home' && <HomePage me={me} onNavigate={setTab} onDailyLogin={() => void claimDailyLogin(true)} />}
        {tab === 'wheel' && <WheelPage me={me} refreshMe={loadMe} />}
        {tab === 'tasks' && <TasksPage />}
        {tab === 'inventory' && <InventoryPage />}
        {tab === 'history' && <HistoryPage />}
        {tab === 'store' && (
          <StorePage spinCredits={me.user.spinCredits} onBack={() => setTab('home')} refreshMe={loadMe} />
        )}
      </div>
      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
}
