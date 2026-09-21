import React, { useState } from 'react';
import { api, ApiError } from '../services/api';
import { LoadingScreen, EmptyState, Toast } from '../components/Common';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { haptic } from '../hooks/useTelegramWebApp';
import { Store, ArrowRight, Coins, ShoppingCart } from 'lucide-react';

interface StoreProduct {
  key: string;
  name: string;
  icon: string;
  imageUrl: string | null;
  price: number;
}

export function StorePage({ spinCredits, onBack, refreshMe }: { spinCredits: number; onBack: () => void; refreshMe: () => void }) {
  const { data: products, error, refetch } = useCachedFetch<StoreProduct[]>('store-products', async () => {
    const res = await api.get<{ ok: true; products: StoreProduct[] }>('/store/products');
    return res.products;
  });
  const [buyingKey, setBuyingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function buy(product: StoreProduct) {
    if (spinCredits < product.price) {
      setToast('عدد فراتك غير كافي لشراء هذه الجائزة.');
      return;
    }
    if (!window.confirm(`تأكيد شراء "${product.name}" مقابل ${product.price} فرة؟`)) return;

    setBuyingKey(product.key);
    haptic('medium');
    try {
      await api.post<{ ok: true; prizeName: string; remainingBalance: number }>('/store/purchase', { key: product.key });
      setToast(`اشتريت "${product.name}" بنجاح! الجائزة في المخزون.`);
      haptic('heavy');
      refreshMe();
      refetch();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_BALANCE') {
        setToast('رصيدك غير كافي.');
      } else {
        setToast('حدث خطأ، حاول مجدداً.');
      }
    } finally {
      setBuyingKey(null);
    }
  }

  return (
    <div>
      <div className="header-row">
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-cyan)' }}>
          <Store size={24} /> متجر القراصنة
        </h2>
        <button className="pill" style={{ cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)' }} onClick={onBack}>
          <ArrowRight size={16} /> العودة
        </button>
      </div>

      <div
        className="card"
        style={{
          textAlign: 'center',
          marginBottom: 16,
          background: 'linear-gradient(160deg, rgba(2, 136, 209, 0.2) 0%, rgba(9, 16, 28, 0.8) 100%)',
          borderColor: 'rgba(38, 198, 218, 0.4)',
        }}
      >
        <div style={{ fontSize: 14, color: 'var(--text-dim)', fontWeight: 700 }}>الفرات المتوفرة للمقايضة</div>
        <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, margin: '8px 0' }}>
          <Coins size={28} /> {spinCredits} فرة
        </div>
      </div>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      {!products && !error && <LoadingScreen label="جاري تفتيش المتجر..." />}
      {!products && Boolean(error) && <LoadingScreen label="تعذر تحميل المتجر، حاول لاحقاً" />}
      {products && products.length === 0 && <EmptyState icon="/logo-skull.png" title="المتجر فارغ حالياً" />}

      {products && products.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {products.map((p) => (
            <div key={p.key} className="card" style={{ textAlign: 'center', padding: 16, display: 'flex', flexDirection: 'column', opacity: spinCredits < p.price ? 0.7 : 1 }}>
              {p.imageUrl ? (
                <img
                  src={p.imageUrl}
                  alt=""
                  style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover', margin: '0 auto 12px', border: '2px solid var(--accent-cyan)' }}
                />
              ) : (
                <div style={{ fontSize: 44, margin: '0 auto 12px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}>{p.icon}</div>
              )}
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8, flex: 1, color: 'var(--text-main)' }}>{p.name}</div>
              <div style={{ fontSize: 15, color: 'var(--accent-cyan)', fontWeight: 900, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Coins size={16} /> {p.price} فرة
              </div>
              <button
                className="btn btn-primary"
                style={{ width: '100%', padding: '10px 0', fontSize: 14, background: spinCredits < p.price ? 'var(--card-border)' : 'linear-gradient(135deg, var(--accent-cyan), #0288d1)' }}
                disabled={buyingKey === p.key || spinCredits < p.price}
                onClick={() => buy(p)}
              >
                {buyingKey === p.key ? 'جاري الشراء...' : spinCredits < p.price ? 'لا يكفي' : <><ShoppingCart size={16} /> شراء</>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}