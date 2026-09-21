import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { ShowcaseResponse } from '../types';
import { LoadingScreen } from '../components/Common';

export function ShowcasePage() {
  const [data, setData] = useState<ShowcaseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get<ShowcaseResponse>('/showcase')
      .then(res => {
        setData(res);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []);

  if (loading) return <LoadingScreen label="جاري التحميل..." />;
  if (error || !data) return (
    <div className="app-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 20 }}>
      <img src="/logo-skull.png" alt="Skull" style={{ width: 120 }} />
      <div style={{ fontSize: 20, color: 'var(--danger)', fontWeight: 800 }}>تعذر تحميل بيانات العجلة</div>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>إعادة المحاولة</button>
    </div>
  );

  return (
    <div className="app-shell" style={{ paddingBottom: 24 }}>
      <div className="app-content">
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <img src="/logo-skull.png" alt="Skull" style={{ width: 140, marginBottom: 10 }} />
          <h1 className="brand-title" style={{ fontSize: 32, marginBottom: 8 }}>عجلة باونتي راش</h1>
          <div style={{ textAlign: 'center', fontSize: 24, fontWeight: 900, marginBottom: 16, color: 'var(--accent-2)', marginTop: -15, letterSpacing: 2 }}>MF</div>
          <p style={{ color: 'var(--text-dim)', fontSize: 16, margin: 0, fontWeight: 700 }}>
            اربح جواهر وحسابات أسطورية
          </p>
        </div>

        <div className="card card-featured" style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2 className="card-title-lg" style={{ color: 'var(--accent)', marginBottom: 12 }}>افتح في تيليجرام للعب!</h2>
          <p style={{ color: 'var(--text-main)', fontSize: 15, marginBottom: 24, lineHeight: 1.6 }}>
            للمشاركة في العجلة والفوز بالجوائز، يجب عليك فتح البوت من داخل تطبيق تيليجرام.
          </p>
          <a
            href={`https://t.me/${data.botUsername}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
            style={{ textDecoration: 'none', padding: '16px 24px', fontSize: 18 }}
          >
            الانتقال إلى البوت
          </a>
        </div>

        <h3 style={{ color: 'var(--accent)', fontSize: 20, margin: '0 0 16px', borderBottom: '1px solid var(--card-border)', paddingBottom: 8 }}>
          الجوائز المتاحة
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {data.prizes.map((prize, idx) => {
            return (
              <div key={idx} className="card" style={{ 
                padding: '16px 12px', 
                textAlign: 'center', 
                marginBottom: 0
              }}>
                <div style={{ 
                  width: 60, height: 60, margin: '0 auto 10px', 
                  background: 'rgba(0,0,0,0.5)', borderRadius: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 32, border: '1px solid var(--card-border)',
                  overflow: 'hidden'
                }}>
                  {prize.imageUrl ? (
                    <img src={prize.imageUrl} alt={prize.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    prize.icon
                  )}
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-main)', marginBottom: 4 }}>
                  {prize.name}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
