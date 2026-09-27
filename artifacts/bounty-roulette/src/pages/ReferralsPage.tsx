import React, { useState } from 'react';
import { ReferralData } from '../types';
import { LoadingScreen } from '../components/Common';
import { api, ApiError } from '../services/api';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { getTelegramWebApp } from '../hooks/useTelegramWebApp';

export function ReferralsPage() {
  const { data, error } = useCachedFetch<ReferralData>('referrals', () => api.get<ReferralData>('/referrals'));
  const [claimingMilestone, setClaimingMilestone] = useState(false);

  if (!data && error) return <LoadingScreen label="تعذر التحميل، حاول لاحقاً" />;
  if (!data) return <LoadingScreen />;

  async function claimReferralMilestone() {
    setClaimingMilestone(true);
    try {
      await api.post('/referrals/milestone/claim');
      window.location.reload();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'لم تكتمل مكافأة الإحالات بعد.');
    } finally {
      setClaimingMilestone(false);
    }
  }

  async function copyReferralLink(link: string) {
    await navigator.clipboard?.writeText(link);
    window.alert('تم نسخ رابط الإحالة');
  }

  function shareReferralLink(link: string) {
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}`;
    getTelegramWebApp()?.openTelegramLink?.(shareUrl);
  }

  return (
    <div>
      <h2 className="page-title">👥 إحالاتي</h2>

      <div className="card">
        <h3 className="card-title">👥 مكافأة الدعوات</h3>
        <p className="card-sub">كل {data.referralRewards.requiredReferrals} دعوة مؤهلة تمنحك {data.referralRewards.rewardPoints} نقطة لعجلة النقاط، وتتكرر المكافأة.</p>
        {data.link && (
          <div style={{ marginTop: 12 }}>
            <div className="card-sub">رابط الإحالة العام — أرسله للأشخاص حتى يدخلون من خلالك:</div>
            <div style={{ direction: 'ltr', wordBreak: 'break-all', fontSize: 12, padding: 10, borderRadius: 10, background: 'rgba(255,255,255,0.06)', margin: '8px 0' }}>
              {data.link}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => void copyReferralLink(data.link!)}>📋 نسخ الرابط</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => shareReferralLink(data.link!)}>📤 مشاركة</button>
            </div>
          </div>
        )}
        <div className="pill" style={{ justifyContent: 'center', margin: '10px 0' }}>
          المؤهل: {data.qualified} · المكافآت الجاهزة: {data.referralRewards.availableMilestones}
        </div>
        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          disabled={data.referralRewards.availableMilestones < 1 || claimingMilestone}
          onClick={() => void claimReferralMilestone()}
        >
          {claimingMilestone ? 'جاري الاستلام...' : data.referralRewards.availableMilestones > 0 ? 'استلام 1.2 نقطة' : 'تحتاج 20 دعوة مؤهلة'}
        </button>
      </div>

      {data.tasks.length > 0 && (
        <div className="card">
          <h3 className="card-title">🎁 روابط استلام الجوائز</h3>
          <p className="card-sub">كل جائزة لها رابط خاص. استخدمه فقط إذا تريد إكمال إحالات تلك الجائزة بالتحديد.</p>
          {data.tasks.map((task) => (
            <div key={task.id} className="list-item" style={{ display: 'block', marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>{task.prizeName}</strong>
                <span className={`status-badge ${task.status === 'completed' ? 'status-approved' : 'status-pending'}`}>
                  {task.creditedCount}/{task.requiredCount}
                </span>
              </div>
              {task.link && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn btn-secondary" style={{ flex: 1, padding: '8px 6px' }} onClick={() => void copyReferralLink(task.link!)}>📋 نسخ</button>
                  <button className="btn btn-primary" style={{ flex: 1, padding: '8px 6px' }} onClick={() => shareReferralLink(task.link!)}>📤 مشاركة</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3 className="card-title">🎁 دعوة الأصدقاء</h3>
        <p className="card-sub">
          تابع إحالاتك من هنا. روابط الجوائز الخاصة واستلام الجوائز تظهر في الحقيبة فقط.
        </p>

        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <div className="pill" style={{ flex: 1, justifyContent: 'center' }}>✅ مؤهلة: {data.qualified}</div>
          <div className="pill" style={{ flex: 1, justifyContent: 'center' }}>⏳ قيد الانتظار: {data.pending}</div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">📋 شروط الإحالة</h3>
        <ul style={{ margin: 0, paddingRight: 18, color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.9 }}>
          {data.rules.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

      {data.referrals.length > 0 && (
        <div className="card">
          <h3 className="card-title">👥 الأشخاص الي دعوتهم</h3>
          {data.referrals.map((r) => (
            <div
              key={r.id}
              className="list-item"
              style={{ cursor: r.invitee ? 'pointer' : 'default' }}
              onClick={() => {
                if (!r.invitee) return;
                if (r.invitee.profileLink.startsWith('https://t.me/')) {
                  getTelegramWebApp()?.openTelegramLink?.(r.invitee.profileLink);
                } else {
                  // No @username on file — best-effort open by numeric ID via Telegram's own URI scheme.
                  window.location.href = r.invitee.profileLink;
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {r.invitee?.photoUrl ? (
                  <img
                    src={r.invitee.photoUrl}
                    alt=""
                    style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: '50%',
                      background: 'var(--accent)',
                      color: '#000',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      fontSize: 14,
                    }}
                  >
                    {(r.invitee?.name || '؟').replace('@', '').charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}><bdi>{r.invitee?.name || 'مستخدم محذوف'}</bdi></div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    {new Date(r.createdAt).toLocaleDateString('ar-EG')}
                  </div>
                </div>
              </div>
              <span className={`status-badge ${r.status === 'qualified' ? 'status-approved' : r.status === 'rejected' ? 'status-rejected' : 'status-pending'}`}>
                {r.status === 'qualified' ? 'مؤهلة ✅' : r.status === 'rejected' ? 'ملغاة 🚫' : 'قيد الانتظار ⏳'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
