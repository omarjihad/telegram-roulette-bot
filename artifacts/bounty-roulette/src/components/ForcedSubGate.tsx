import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../services/api';
import { getTelegramWebApp } from '../hooks/useTelegramWebApp';
import { ForcedSubMissing } from '../types';
import { Megaphone, ExternalLink, CheckCircle } from 'lucide-react';
import { LoadingScreen } from './Common';

export function ForcedSubGate({ onPassed }: { onPassed: () => void }) {
  const [missing, setMissing] = useState<ForcedSubMissing[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setChecking(true);
    setError(null);
    try {
      const res = await api.get<{ ok: true; allOk: boolean; missing: ForcedSubMissing[] }>('/forced-sub/status');
      if (res.allOk) {
        onPassed();
      } else {
        setMissing(res.missing);
      }
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'تعذر التحقق من الاشتراك، حاول مرة أخرى.');
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }

  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openChannel(url?: string) {
    if (!url) return;
    getTelegramWebApp()?.openTelegramLink?.(url);
  }

  if (loading) return <LoadingScreen />;

  return (
    <div className="app-shell">
      <div className="app-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', padding: 20 }}>
        <div className="card" style={{ width: '100%', padding: '30px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <Megaphone size={56} color="var(--accent)" />
          </div>
          <h2 className="card-title" style={{ textAlign: 'center', fontSize: 24 }}>اشترك عشان تكمل</h2>
          <p className="card-sub" style={{ textAlign: 'center', marginBottom: 24, fontSize: 16, lineHeight: 1.6 }}>
            لازم تشترك بالقنوات التالية قبل ما تكدر تستخدم البوت
          </p>

          {error && <p style={{ color: 'var(--danger)', marginBottom: 20, textAlign: 'center', fontWeight: 700, padding: '10px', background: 'rgba(229, 57, 53, 0.1)', borderRadius: 8, border: '1px solid rgba(229, 57, 53, 0.3)' }}>{error}</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
            {missing.map((chan) => (
              <div className="channel-row" key={chan.chatId} style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 16px', borderRadius: 12 }}>
                <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-main)' }}>{chan.title}</span>
                <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px', fontSize: 14 }} onClick={() => openChannel(chan.inviteLink)}>
                  <ExternalLink size={16} /> انضمام
                </button>
              </div>
            ))}
          </div>

          <button className="btn btn-primary" style={{ padding: '14px 20px', fontSize: 16 }} disabled={checking} onClick={check}>
            {checking ? '...جاري التحقق' : <><CheckCircle size={18} /> تم الانضمام</>}
          </button>
        </div>
      </div>
    </div>
  );
}