import React from 'react';

export function LoadingScreen({ label = 'جاري التحميل...' }: { label?: string }) {
  return (
    <div className="loading-screen">
      <div className="spinner" />
      <p style={{ color: 'var(--text-dim)' }}>{label}</p>
    </div>
  );
}

export function EmptyState({ icon = '/logo-skull.png', title, subtitle }: { icon?: string; title: string; subtitle?: string }) {
  return (
    <div className="empty-state">
      <img src={icon.startsWith('/') ? icon : '/logo-skull.png'} alt="" style={{ width: 64, margin: '0 auto 16px', opacity: 0.5, filter: 'grayscale(100%)' }} />
      <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6, color: 'var(--text-main)' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 14 }}>{subtitle}</div>}
    </div>
  );
}

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  React.useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);
  return <div className="toast">{message}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'نشطة',
    claim_requested: 'قيد المراجعة',
    approved: 'تم القبول',
    delivered: 'تم التسليم',
    rejected: 'مرفوضة',
    expired: 'منتهية',
  };
  const cls: Record<string, string> = {
    active: 'status-active',
    claim_requested: 'status-pending',
    approved: 'status-approved',
    delivered: 'status-approved',
    rejected: 'status-rejected',
    expired: 'status-expired',
  };
  return <span className={`status-badge ${cls[status] || ''}`}>{map[status] || status}</span>;
}
