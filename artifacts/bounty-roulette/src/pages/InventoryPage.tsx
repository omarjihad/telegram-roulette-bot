import React, { useState } from 'react';
import { api, ApiError } from '../services/api';
import { InventoryItem } from '../types';
import { LoadingScreen, EmptyState, StatusBadge } from '../components/Common';
import { useCountdown } from '../hooks/useCountdown';
import { haptic, getTelegramWebApp } from '../hooks/useTelegramWebApp';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { DeliveryContactGate } from '../components/DeliveryContactGate';

function ExpiryLabel({ expiresAt }: { expiresAt: string | null }) {
  const { label, isReady } = useCountdown(expiresAt);
  if (!expiresAt) return null;
  if (isReady) return <span className="expiry-chip expiry-chip-over">⌛ انتهت الصلاحية</span>;
  const urgent = new Date(expiresAt).getTime() - Date.now() < 3 * 60 * 60 * 1000;
  return <span className={`expiry-chip ${urgent ? 'expiry-chip-urgent' : ''}`}>⏳ {label}</span>;
}

function TaskProgress({ task, onCopy, onShare, sharing }: {
  task: NonNullable<InventoryItem['task']>;
  onCopy: () => void;
  onShare: () => void;
  sharing?: boolean;
}) {
  if (task.status === 'completed') {
    return (
      <div style={{ marginTop: 10, fontSize: 13, color: 'var(--accent-2)' }}>
        ✅ أكملت {task.creditedCount}/{task.requiredCount} دعوات — تكدر تستلم الجائزة الحين
      </div>
    );
  }
  if (task.status === 'expired') {
    return <div style={{ marginTop: 10, fontSize: 13, color: 'var(--danger)' }}>⌛ انتهت مهلة مهمة الدعوات</div>;
  }
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.6 }}>
        🎯 ادعُ {task.requiredCount} أشخاص عن طريق رابطك الخاص بهذي الجائزة عشان تكدر تستلمها.
        إذا ما كملت قبل ما يخلص الوقت، الجائزة ترجع لمخزون البوت.
      </div>
      <div className="task-progress" aria-label={`${task.creditedCount} من ${task.requiredCount}`}>
        <div className="task-progress-track">
          <div
            className="task-progress-fill"
            style={{ width: `${Math.min(100, (task.creditedCount / Math.max(1, task.requiredCount)) * 100)}%` }}
          />
        </div>
        <span className="task-progress-count">{task.creditedCount}/{task.requiredCount}</span>
      </div>
      {task.link && (
        <>
          <div
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid var(--card-border)',
              borderRadius: 10,
              padding: '8px 12px',
              fontSize: 12,
              wordBreak: 'break-all',
              marginBottom: 8,
              color: 'var(--text-dim)',
            }}
          >
            {task.link}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" style={{ padding: '6px 14px', fontSize: 13 }} onClick={onCopy}>
              📋 نسخ
            </button>
            <button className="btn btn-primary" style={{ padding: '6px 14px', fontSize: 13 }} onClick={onShare} disabled={sharing}>
              {sharing ? '📤 جاري الإرسال...' : '📤 مشاركة'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function InventoryPage() {
  const { data: items, error, refetch } = useCachedFetch<InventoryItem[]>('inventory', async () => {
    const res = await api.get<{ ok: true; items: InventoryItem[] }>('/inventory');
    return res.items;
  });
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [deliveryItem, setDeliveryItem] = useState<InventoryItem | null>(null);

  const [sharingId, setSharingId] = useState<string | null>(null);

  function copyLink(link: string) {
    navigator.clipboard?.writeText(link).then(() => {
      setToast('تم نسخ الرابط ✅');
      haptic('light');
    });
  }

  async function shareLink(userPrizeId: string) {
    setSharingId(userPrizeId);
    haptic('light');
    try {
      const res = await api.post<{ ok: true; preparedMessageId: string }>('/inventory/share-card', { userPrizeId });
      const tg = getTelegramWebApp();
      if (!tg?.shareMessage) {
        setToast('نسخة تيليجرام عندك قديمة وما تدعم المشاركة المباشرة، حدّث التطبيق وجرب مرة ثانية.');
        return;
      }
      tg.shareMessage(res.preparedMessageId, (sent) => {
        if (sent) {
          setToast('تم إرسال الجائزة ✅');
          haptic('light');
        }
      });
    } catch {
      setToast('تعذر تجهيز بطاقة المشاركة، حاول مرة ثانية.');
    } finally {
      setSharingId(null);
    }
  }

  async function claim(item: InventoryItem) {
    setClaimingId(item.id);
    haptic('light');
    try {
      await api.post('/inventory/claim', { userPrizeId: item.id });
      setToast('تم إرسال طلب الاستلام، بانتظار المراجعة ⏳');
      await refetch();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'EXPIRED') setToast('عذراً، انتهت صلاحية هذه الجائزة.');
        else if (err.code === 'ALREADY_REQUESTED') setToast('تم إرسال الطلب مسبقاً.');
        else if (err.code === 'REFERRALS_REQUIRED') setToast('لازم تكمل عدد الدعوات المطلوب أولاً.');
        else if (err.code === 'DELIVERY_CONTACT_REQUIRED') {
          setDeliveryItem(item);
        }
        else setToast('صار خطأ، حاول مرة ثانية.');
      } else {
        setToast('صار خطأ، حاول مرة ثانية.');
      }
    } finally {
      setClaimingId(null);
    }
  }

  if (!items && error) return <LoadingScreen label="تعذر التحميل، حاول لاحقاً" />;
  if (!items) return <LoadingScreen />;
  if (deliveryItem) {
    return (
      <DeliveryContactGate
        onBack={() => setDeliveryItem(null)}
        onVerified={() => {
          const itemToRetry = deliveryItem;
          setDeliveryItem(null);
          void claim(itemToRetry);
        }}
      />
    );
  }

  return (
    <div>
      <h2 className="page-title">🎒 المخزون</h2>

      {items.length === 0 && (
        <EmptyState icon="🎒" title="حقيبتك فارغة حالياً" subtitle="روح للفرة المجانية ودور عشان تربح جوائز" />
      )}

      {items.map((item) => {
        const canClaim = item.status === 'active' && (!item.task || item.task.status === 'completed');
        return (
          <div className={`card inventory-card ${item.status === 'active' ? 'inventory-card-active' : ''}`} key={item.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="inventory-prize-icon"
                    style={{ objectFit: 'cover' }}
                  />
                ) : (
                  <div className="inventory-prize-icon">{item.icon}</div>
                )}
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{item.prizeName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    {item.source === 'referral'
                      ? '🎁 مكافأة إحالة'
                      : item.source === 'store'
                      ? '🏪 من المتجر'
                      : '🎰 من الفرة المجانية'}
                  </div>
                </div>
              </div>
              <StatusBadge status={item.status} />
            </div>

            {item.status === 'active' && item.task && (
              <TaskProgress
                task={item.task}
                onCopy={() => item.task?.link && copyLink(item.task.link)}
                onShare={() => shareLink(item.id)}
                sharing={sharingId === item.id}
              />
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
              <ExpiryLabel expiresAt={item.expiresAt} />
              {item.status === 'active' && canClaim && (
                <button
                  className="btn btn-primary"
                  style={{ width: 'auto', padding: '10px 22px' }}
                  disabled={claimingId === item.id}
                  onClick={() => claim(item)}
                >
                  {claimingId === item.id ? '...' : '📦 استلام'}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}