import React, { useState } from 'react';
import { tr } from '../i18n';
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
  if (isReady) return <span className="expiry-chip expiry-chip-over">{tr('⌛ انتهت الصلاحية', '⌛ Expired')}</span>;
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
        {tr(`✅ أكملت ${task.creditedCount}/${task.requiredCount} دعوات — تكدر تستلم الجائزة الحين`, `✅ ${task.creditedCount}/${task.requiredCount} invites done — you can claim the prize now`)}
      </div>
    );
  }
  if (task.status === 'expired') {
    return <div style={{ marginTop: 10, fontSize: 13, color: 'var(--danger)' }}>{tr('⌛ انتهت مهلة مهمة الدعوات', '⌛ The invite task has expired')}</div>;
  }
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.6 }}>
        {tr(`🎯 ادعُ ${task.requiredCount} أشخاص عن طريق رابطك الخاص بهذي الجائزة عشان تكدر تستلمها. إذا ما كملت قبل ما يخلص الوقت، الجائزة ترجع لمخزون البوت.`, `🎯 Invite ${task.requiredCount} people with this prize’s own link to claim it. If you don’t finish before time runs out, the prize goes back to the bot.`)}
      </div>
      <div className="task-progress" aria-label={`${task.creditedCount} / ${task.requiredCount}`}>
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
              {tr('📋 نسخ', '📋 Copy')}
            </button>
            <button className="btn btn-primary" style={{ padding: '6px 14px', fontSize: 13 }} onClick={onShare} disabled={sharing}>
              {sharing ? tr('📤 جاري الإرسال...', '📤 Sending...') : tr('📤 مشاركة', '📤 Share')}
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
      setToast(tr('تم نسخ الرابط ✅', 'Link copied ✅'));
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
        setToast(tr('نسخة تيليجرام عندك قديمة وما تدعم المشاركة المباشرة، حدّث التطبيق وجرب مرة ثانية.', 'Your Telegram version is too old for direct sharing. Update the app and try again.'));
        return;
      }
      tg.shareMessage(res.preparedMessageId, (sent) => {
        if (sent) {
          setToast(tr('تم إرسال الجائزة ✅', 'Prize sent ✅'));
          haptic('light');
        }
      });
    } catch {
      setToast(tr('تعذر تجهيز بطاقة المشاركة، حاول مرة ثانية.', 'Could not prepare the share card, please try again.'));
    } finally {
      setSharingId(null);
    }
  }

  async function claim(item: InventoryItem) {
    setClaimingId(item.id);
    haptic('light');
    try {
      await api.post('/inventory/claim', { userPrizeId: item.id });
      setToast(tr('تم إرسال طلب الاستلام، بانتظار المراجعة ⏳', 'Claim request sent, awaiting review ⏳'));
      await refetch();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'EXPIRED') setToast(tr('عذراً، انتهت صلاحية هذه الجائزة.', 'Sorry, this prize has expired.'));
        else if (err.code === 'ALREADY_REQUESTED') setToast(tr('تم إرسال الطلب مسبقاً.', 'The request was already sent.'));
        else if (err.code === 'REFERRALS_REQUIRED') setToast(tr('لازم تكمل عدد الدعوات المطلوب أولاً.', 'You need to complete the required invites first.'));
        else if (err.code === 'TELEGRAM_ONLY') setToast(err.message);
        else if (err.code === 'DELIVERY_CONTACT_REQUIRED') {
          setDeliveryItem(item);
        }
        else setToast(tr('صار خطأ، حاول مرة ثانية.', 'Something went wrong, please try again.'));
      } else {
        setToast(tr('صار خطأ، حاول مرة ثانية.', 'Something went wrong, please try again.'));
      }
    } finally {
      setClaimingId(null);
    }
  }

  if (!items && error) return <LoadingScreen label={tr('تعذر التحميل، حاول لاحقاً', 'Could not load, try again later')} />;
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
      <h2 className="page-title">{tr('🎒 المخزون', '🎒 Inventory')}</h2>

      {items.length === 0 && (
        <EmptyState icon="🎒" title={tr('حقيبتك فارغة حالياً', 'Your inventory is empty')} subtitle={tr('روح للفرة المجانية ودور عشان تربح جوائز', 'Go to the free spin and spin to win prizes')} />
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
                      ? tr('🎁 مكافأة إحالة', '🎁 Referral reward')
                      : item.source === 'store'
                      ? tr('🏪 من المتجر', '🏪 From the store')
                      : tr('🎰 من الفرة المجانية', '🎰 From the free spin')}
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
                  {claimingId === item.id ? '...' : tr('📦 استلام', '📦 Claim')}
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