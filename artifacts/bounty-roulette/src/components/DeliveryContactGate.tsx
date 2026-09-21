import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle, ExternalLink, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../services/api';
import { getTelegramWebApp } from '../hooks/useTelegramWebApp';
import { LoadingScreen } from './Common';

interface DeliveryContact {
  link: string | null;
  username: string | null;
  firstName: string | null;
  verified: boolean;
}

interface DeliveryContactGateProps {
  onVerified: () => void;
  onBack: () => void;
}

export function DeliveryContactGate({ onVerified, onBack }: DeliveryContactGateProps) {
  const [contact, setContact] = useState<DeliveryContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadContact() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ ok: true; deliveryContact: DeliveryContact }>('/delivery-contact');
      setContact(res.deliveryContact);
      if (res.deliveryContact.verified) onVerified();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر تحميل حساب التسليم، حاول مرة ثانية.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadContact();
  }, []);

  function openDeliveryAccount() {
    if (!contact?.link) {
      setError('حساب التسليم غير مهيأ حالياً.');
      return;
    }
    getTelegramWebApp()?.openTelegramLink?.(contact.link);
  }

  async function verifyContact() {
    setChecking(true);
    setError(null);
    try {
      await api.post<{ ok: true; verified: true }>('/delivery-contact/verify');
      onVerified();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل التحقق. أضف الحساب إلى جهات اتصالك ثم حاول مرة ثانية.');
    } finally {
      setChecking(false);
    }
  }

  if (loading) return <LoadingScreen label="جاري تحميل حساب التسليم..." />;

  return (
    <div className="app-shell">
      <div className="app-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 20 }}>
        <div className="card" style={{ width: '100%', padding: '30px 20px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <ShieldCheck size={58} color="var(--accent)" />
          </div>
          <h2 className="card-title" style={{ fontSize: 24, marginBottom: 10 }}>أضف حساب التسليم</h2>
          <p className="card-sub" style={{ fontSize: 15, lineHeight: 1.8, marginBottom: 22 }}>
            حتى نكدر نسلّمك الجائزة، أضف حساب التسليم إلى جهات اتصالك أولاً.
            <br />
            بعدها ارجع واضغط زر التحقق. سيحاول الحساب إرسال رسالة تأكيد لك.
          </p>

          {contact?.username && (
            <div style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 16 }}>
              حساب التسليم: <strong style={{ color: 'var(--text-main)' }}>@{contact.username.replace(/^@/, '')}</strong>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button className="btn btn-primary" style={{ minHeight: 54, fontSize: 17 }} onClick={openDeliveryAccount}>
              <ExternalLink size={20} />
              إضافة حساب التسليم إلى جهات الاتصال
            </button>
            <button className="btn btn-secondary" style={{ minHeight: 54, fontSize: 16 }} disabled={checking} onClick={verifyContact}>
              <CheckCircle size={19} />
              {checking ? 'جاري التحقق...' : 'تحقق من الإضافة'}
            </button>
          </div>

          {error && (
            <p style={{ color: 'var(--danger)', fontSize: 13, lineHeight: 1.7, margin: '16px 0 0', padding: 10, background: 'rgba(229, 57, 53, 0.1)', borderRadius: 8, border: '1px solid rgba(229, 57, 53, 0.3)' }}>
              {error}
            </p>
          )}

          <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={onBack}>
            <ArrowLeft size={17} />
            رجوع للمخزون
          </button>
        </div>
      </div>
    </div>
  );
}