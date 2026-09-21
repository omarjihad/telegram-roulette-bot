import React, { useEffect } from 'react';
import { api } from '../services/api';
import { NotificationItem } from '../types';
import { LoadingScreen, EmptyState } from '../components/Common';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { Bell, Gift, AlertTriangle, Clock, CheckCircle, XCircle, Aperture, Users, PartyPopper, Megaphone, ScrollText } from 'lucide-react';

const ICONS: Record<string, React.ReactNode> = {
  prize_won: <Gift size={18} color="var(--accent)" />,
  prize_expiring: <AlertTriangle size={18} color="var(--accent-3)" />,
  claim_pending: <Clock size={18} color="var(--text-dim)" />,
  claim_approved: <CheckCircle size={18} color="var(--success)" />,
  claim_rejected: <XCircle size={18} color="var(--danger)" />,
  wheel_ready: <Aperture size={18} color="var(--accent-cyan)" />,
  referral_progress: <Users size={18} color="var(--accent-2)" />,
  referral_reward: <PartyPopper size={18} color="var(--accent)" />,
  system_announcement: <Megaphone size={18} color="var(--text-main)" />,
};

export function HistoryPage() {
  const { data: items, error } = useCachedFetch<NotificationItem[]>('notifications', async () => {
    const res = await api.get<{ ok: true; items: NotificationItem[] }>('/notifications');
    return res.items;
  });

  useEffect(() => {
    api.post('/notifications/read').catch(() => {});
  }, []);

  if (!items && error) return <LoadingScreen label="تعذر التحميل، حاول لاحقاً" />;
  if (!items) return <LoadingScreen />;

  return (
    <div>
      <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent)' }}>
        <ScrollText size={24} /> السجل
      </h2>

      {items.length === 0 && <EmptyState icon="/logo-skull.png" title="ما فيه أي نشاط بعد" />}

      {items.map((n) => (
        <div className="list-item" key={n._id} style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 10, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.05)', position: 'relative', overflow: 'hidden' }}>
          {!n.isRead && (
            <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 4, background: 'var(--accent)' }} />
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
            <span style={{ fontWeight: 900, display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, color: 'var(--text-main)' }}>
              {ICONS[n.type] || <Bell size={18} />} {n.title}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>
              {new Date(n.createdAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-dim)', whiteSpace: 'pre-line', lineHeight: 1.6 }}>{n.body}</p>
        </div>
      ))}
    </div>
  );
}