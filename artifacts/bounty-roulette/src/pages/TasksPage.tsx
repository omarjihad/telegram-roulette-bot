import React, { useState } from 'react';
import { ReferralData } from '../types';
import { LoadingScreen } from '../components/Common';
import { api, ApiError } from '../services/api';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { getTelegramWebApp } from '../hooks/useTelegramWebApp';
import { AdTaskCard } from '../components/AdTaskCard';

export function TasksPage({ refreshMe }: { refreshMe?: () => void }) {
  const { data, error } = useCachedFetch<ReferralData>('referrals', () => api.get<ReferralData>('/referrals'));
  const [claimingTask, setClaimingTask] = useState<string | null>(null);

  if (!data && error) return <LoadingScreen label="تعذر التحميل، حاول لاحقاً" />;
  if (!data) return <LoadingScreen />;

  async function claimSubscriptionTask(taskId: string) {
    setClaimingTask(taskId);
    try {
      await api.post(`/tasks/${taskId}/claim`);
      window.location.reload();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'اشترك أولاً ثم حاول مرة ثانية.');
    } finally {
      setClaimingTask(null);
    }
  }

  async function copyText(value: string, label: string) {
    await navigator.clipboard?.writeText(value);
    window.alert(`تم نسخ ${label}`);
  }

  return (
    <div>
      <h2 className="page-title">🎯 المهام</h2>

      <AdTaskCard onEarned={refreshMe} />

      <div className="card">
          <h3 className="card-title">📢 المهام</h3>
          <p className="card-sub">أكمل شرط المهمة، ثم اضغط تحقق حتى تستلم نقاطها مرة واحدة. مهام الملف الشخصي يعاد فحصها كل 5 دقائق.</p>
        {data.subscriptionTasks.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>لا توجد مهام اشتراك حالياً.</div>}
        {data.subscriptionTasks.map((task) => (
          <div key={task.id} className="list-item" style={{ display: 'block', marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>{task.title}</strong>
              <span className={`status-badge ${task.claimed ? 'status-approved' : 'status-pending'}`}>
                {task.claimed ? 'مستلمة ✅' : `+${task.rewardPoints} نقطة`}
              </span>
            </div>
            <div className="card-sub" style={{ marginTop: 6 }}>
              {task.taskType === 'folder'
                ? 'أضف المجلد ثم تأكد من انضمامك لقناة التحقق.'
                : task.taskType === 'profile_name'
                ? 'ضع MF بجانب اسم Telegram.'
                : task.taskType === 'profile_bio'
                ? 'ضع @mfbisnes في بايو Telegram.'
                : 'اشترك بالقناة أو الكروب.'}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {task.taskType === 'folder' && task.folderLink && (
                <button className="btn btn-secondary" style={{ flex: 1, padding: '8px 6px' }} onClick={() => getTelegramWebApp()?.openTelegramLink?.(task.folderLink!)}>
                  فتح المجلد
                </button>
              )}
              {task.taskType === 'subscription' && task.inviteLink && (
                <button className="btn btn-secondary" style={{ flex: 1, padding: '8px 6px' }} onClick={() => getTelegramWebApp()?.openTelegramLink?.(task.inviteLink!)}>
                  فتح الاشتراك
                </button>
              )}
              {task.taskType === 'profile_name' && (
                <button className="btn btn-secondary" style={{ flex: 1, padding: '8px 6px' }} onClick={() => void copyText('MF', 'شعار MF')}>
                  📋 نسخ MF
                </button>
              )}
              {task.taskType === 'profile_bio' && (
                <button className="btn btn-secondary" style={{ flex: 1, padding: '8px 6px' }} onClick={() => void copyText('@mfbisnes', 'اسم المستخدم')}>
                  📋 نسخ @mfbisnes
                </button>
              )}
              <button className="btn btn-primary" style={{ flex: 1, padding: '8px 6px' }} disabled={task.claimed || claimingTask === String(task.id)} onClick={() => void claimSubscriptionTask(String(task.id))}>
                {task.claimed ? 'تم الاستلام' : claimingTask === String(task.id) ? 'جاري التحقق...' : 'تحقق واستلم'}
              </button>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
