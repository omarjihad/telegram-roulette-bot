import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../services/api';
import { ShieldQuestion } from 'lucide-react';

interface Challenge {
  sessionId: string;
  question: string;
  options: number[];
}

export function CaptchaGate({ onPassed }: { onPassed: () => void }) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function loadChallenge() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<{ ok: true; alreadyPassed: boolean; challenge?: Challenge }>('/captcha/request');
      if (res.alreadyPassed) {
        onPassed();
        return;
      }
      setChallenge(res.challenge ?? null);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'تعذر تحميل التحقق، حاول مرة ثانية.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadChallenge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(answer: number) {
    if (!challenge || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/captcha/submit', { sessionId: challenge.sessionId, answer });
      onPassed();
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : 'إجابة خاطئة، حاول مرة ثانية.');
      loadChallenge();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="app-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', padding: 20 }}>
        <div className="card" style={{ textAlign: 'center', width: '100%', padding: '40px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <ShieldQuestion size={56} color="var(--accent)" />
          </div>
          <h2 className="card-title" style={{ fontSize: 24 }}>تحقق سريع</h2>
          <p className="card-sub" style={{ fontSize: 16, lineHeight: 1.6 }}>حل المسألة البسيطة عشان نتأكد إنك مو بوت</p>

          {loading && <div className="spinner" style={{ margin: '30px auto' }} />}
          {!loading && challenge && (
            <>
              <div style={{ fontSize: 32, fontWeight: 900, margin: '30px 0 10px', color: 'var(--text-main)', letterSpacing: 2 }}>{challenge.question}</div>
              <div className="captcha-options">
                {challenge.options.map((opt) => (
                  <button
                    key={opt}
                    className="captcha-option"
                    disabled={submitting}
                    onClick={() => submit(opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </>
          )}
          {error && <p style={{ color: 'var(--danger)', marginTop: 20, fontWeight: 700, padding: '10px', background: 'rgba(229, 57, 53, 0.1)', borderRadius: 8, border: '1px solid rgba(229, 57, 53, 0.3)' }}>{error}</p>}
        </div>
      </div>
    </div>
  );
}