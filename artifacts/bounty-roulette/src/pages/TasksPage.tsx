import React, { useState } from 'react';
import { tr } from '../i18n';
import { ReferralData } from '../types';
import { LoadingScreen } from '../components/Common';
import { api, ApiError } from '../services/api';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { getTelegramWebApp } from '../hooks/useTelegramWebApp';
import { AdTaskCard } from '../components/AdTaskCard';

export function TasksPage({ refreshMe }: { refreshMe?: () => void }) {
  const { data, error } = useCachedFetch<ReferralData>('referrals', () => api.get<ReferralData>('/referrals'));
  const [claimingTask, setClaimingTask] = useState<string | null>(null);

  if (!data && error) return <LoadingScreen label={tr('تعذر التحميل، حاول لاحقاً', 'Could not load, try again later')} />;
  if (!data) return <LoadingScreen />;

  async function claimSubscriptionTask(taskId: string) {
    setClaimingTask(taskId);
    try {
      await api.post(`/tasks/${taskId}/claim`);
      window.location.reload();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : tr('اشترك أولاً ثم حاول مرة ثانية.', 'Subscribe first, then try again.'));
    } finally {
      setClaimingTask(null);
    }
  }

  async function copyText(value: string, label: string) {
    await navigator.clipboard?.writeText(value);
    window.alert(tr(`تم نسخ ${label}`, `Copied ${label}`));
  }

  return (
    <div>
      <h2 className="page-title">{tr('🎯 المهام', '🎯 Tasks')}</h2>

      <AdTaskCard onEarned={refreshMe} />

      <div className="card">
          <h3 className="card-title">{tr('📢 المهام', '📢 Tasks')}</h3>
          <p className="card-sub">{tr('أكمل شرط المهمة، ثم اضغط تحقق حتى تستلم نقاطها مرة واحدة. مهام الملف الشخصي يعاد فحصها كل 5 دقائق.', 'Complete the task, then tap verify to collect its points once. Profile tasks are re-checked every 5 minutes.')}</p>
        {data.subscriptionTasks.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{tr('لا توجد مهام اشتراك حالياً.', 'No subscription tasks right now.')}</div>}
        {data.subscriptionTasks.map((task) => (
          <div key={task.id} className="list-item" style={{ display: 'block', marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>{task.title}</strong>
              <span className={`status-badge ${task.claimed ? 'status-approved' : 'status-pending'}`}>
                {task.claimed ? tr('مستلمة ✅', 'Collected ✅') : tr(`+${task.rewardPoints} نقطة`, `+${task.rewardPoints} pts`)}
              </span>
            </div>
            <div className="card-sub" style={{ marginTop: 6 }}>
              {task.taskType === 'folder'
                ? tr('أضف المجلد ثم تأكد من انضمامك لقناة التحقق.', 'Add the folder, then make sure you joined the verification channel.')
                : task.taskType === 'profile_name'
                ? tr('ضع MF بجانب اسم Telegram.', 'Put MF next to your Telegram name.')
                : task.taskType === 'profile_bio'
                ? tr('ضع @mfbisnes في بايو Telegram.', 'Put @mfbisnes in your Telegram bio.')
                : tr('اشترك بالقناة أو الكروب.', 'Join the channel or group.')}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {task.taskType === 'folder' && task.folderLink && (
                <button className="btn btn-secondary" style={{ flex: 1, padding: '8px 6px' }} onClick={() => getTelegramWebApp()?.openTelegramLink?.(task.folderLink!)}>
                  {tr('فتح المجلد', 'Open folder')}
                </button>
              )}
              {task.taskType === 'subscription' && task.inviteLink && (
                <button className="btn btn-secondary" style={{ flex: 1, padding: '8px 6px' }} onClick={() => getTelegramWebApp()?.openTelegramLink?.(task.inviteLink!)}>
                  {tr('فتح الاشتراك', 'Open channel')}
                </button>
              )}
              {task.taskType === 'profile_name' && (
                <button className="btn btn-secondary" style={{ flex: 1, padding: '8px 6px' }} onClick={() => void copyText('MF', tr('شعار MF', 'the MF tag'))}>
                  {tr('📋 نسخ MF', '📋 Copy MF')}
                </button>
              )}
              {task.taskType === 'profile_bio' && (
                <button className="btn btn-secondary" style={{ flex: 1, padding: '8px 6px' }} onClick={() => void copyText('@mfbisnes', tr('اسم المستخدم', 'the username'))}>
                  {tr('📋 نسخ @mfbisnes', '📋 Copy @mfbisnes')}
                </button>
              )}
              <button className="btn btn-primary" style={{ flex: 1, padding: '8px 6px' }} disabled={task.claimed || claimingTask === String(task.id)} onClick={() => void claimSubscriptionTask(String(task.id))}>
                {task.claimed ? tr('تم الاستلام', 'Collected') : claimingTask === String(task.id) ? tr('جاري التحقق...', 'Checking...') : tr('تحقق واستلم', 'Verify & collect')}
              </button>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
