import React, { useCallback, useEffect, useState } from 'react';
import { getLang, locale, tr } from '../i18n';
import { getTelegramWebApp } from '../hooks/useTelegramWebApp';
import { api } from '../services/api';
import { ProofPostView, ProofsResponse } from '../types';
import { ImageViewer } from '../components/ImageViewer';
import { SectionHero } from '../components/Common';

function openLink(url: string) {
  const tg = getTelegramWebApp();
  if (tg?.openTelegramLink && tg.initData) tg.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener');
}

// Plain fetch on purpose: the proofs are public, so they show on the website preview too.
async function loadProofs(before?: number): Promise<ProofsResponse> {
  const res = await fetch(`/api/proofs${before ? `?before=${before}` : ''}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.message || 'failed');
  return body as ProofsResponse;
}

function PostMedia({ post, onZoom }: { post: ProofPostView; onZoom: (src: string) => void }) {
  if (post.media.length === 0) return null;
  const many = post.media.length > 1;
  return (
    <div className={`proof-media ${many ? 'proof-media-grid' : ''} ${post.media.length === 3 ? 'proof-media-three' : ''}`}>
      {post.media.slice(0, 4).map((m, i) => (
        <button
          key={m.url}
          className="proof-media-item"
          onClick={() => (m.type === 'video' ? openLink(post.url) : onZoom(m.url))}
          aria-label={m.type === 'video' ? tr('تشغيل الفيديو', 'Play video') : tr('تكبير الصورة', 'Zoom image')}
        >
          <img src={m.url} alt="" loading="lazy" onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')} />
          {m.type === 'video' && <span className="proof-play">▶</span>}
          {i === 3 && post.media.length > 4 && <span className="proof-more">+{post.media.length - 4}</span>}
        </button>
      ))}
    </div>
  );
}

function PostCard({ post, isAdmin, onHide, onZoom }: { post: ProofPostView; isAdmin: boolean; onHide: (id: number) => void; onZoom: (src: string) => void }) {
  const en = getLang() === 'en';
  const headline = en ? post.headlineEn : post.headlineAr;
  // The other language's text when it couldn't be translated, so nothing is left blank.
  const desc = (en ? post.descEn : post.descAr) || post.text;
  return (
    <article className="card proof-card">
      <PostMedia post={post} onZoom={onZoom} />
      <div className="proof-body">
        <div className="proof-headline">{headline}</div>
        {desc && (
          <p className="proof-desc" dir="auto">
            {/* @usernames and links keep their own direction inside Arabic text. */}
            {desc.split(/(@\w+|https?:\/\/\S+)/g).map((part, i) => (i % 2 ? <bdi key={i} dir="ltr">{part}</bdi> : part))}
          </p>
        )}
        <div className="proof-meta">
          {post.date && <span>🕒 {new Date(post.date).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
          {post.views && <span>👁️ <bdi dir="ltr">{post.views}</bdi></span>}
          <button className="proof-open" onClick={() => openLink(post.url)}>{tr('فتح بالقناة ↗', 'Open in channel ↗')}</button>
        </div>
        {isAdmin && (
          <button className="proof-hide" onClick={() => onHide(post.id)}>{tr('🙈 إخفاء من التطبيق', '🙈 Hide from the app')}</button>
        )}
      </div>
    </article>
  );
}

export function ProofsPage({ onBack, isAdmin = false }: { onBack: () => void; isAdmin?: boolean }) {
  const [data, setData] = useState<ProofsResponse | null>(null);
  const [posts, setPosts] = useState<ProofPostView[]>([]);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(false);
    loadProofs()
      .then((r) => {
        setData(r);
        setPosts(r.posts);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(load, [load]);

  async function more() {
    if (!data || loadingMore || posts.length === 0) return;
    setLoadingMore(true);
    try {
      const r = await loadProofs(posts[posts.length - 1].id);
      setPosts((cur) => [...cur, ...r.posts]);
      setData((d) => (d ? { ...d, hasMore: r.hasMore } : d));
    } catch {
      // Keep what's shown; the button stays for another try.
    } finally {
      setLoadingMore(false);
    }
  }

  async function hide(id: number) {
    if (!window.confirm(tr('إخفاء هذا المنشور من التطبيق؟ (يبقى بالقناة)', 'Hide this post from the app? (It stays in the channel.)'))) return;
    try {
      await api.post(`/admin/proofs/${id}/hidden`, { hidden: true });
      setPosts((cur) => cur.filter((p) => p.id !== id));
    } catch {
      window.alert(tr('تعذر الإخفاء', "Couldn't hide it"));
    }
  }

  const channelUrl = data?.channelUrl ?? 'https://t.me/MFROLET';
  const channel = data?.channel ?? 'MFROLET';

  return (
    <div className="proofs-page">
      <SectionHero
        art="proofs"
        title={tr('📸 قناة الإثباتات', '📸 Proofs')}
        subtitle={tr('جوائز حقيقية تسلّمت للفائزين، من قناتنا الرسمية', 'Real prizes delivered to winners, from our official channel')}
        onBack={onBack}
      >
        <div className="proofs-hero-row">
          <bdi dir="ltr" className="proofs-handle">@{channel}</bdi>
          <button className="btn btn-primary proofs-join" onClick={() => openLink(channelUrl)}>{tr('📢 انضم', '📢 Join')}</button>
        </div>
      </SectionHero>

      {error && (
        <div className="card ex-empty">
          <div style={{ fontSize: 40 }}>📡</div>
          <p>{tr('تعذر تحميل المنشورات حالياً.', "Couldn't load the posts right now.")}</p>
          <button className="btn btn-secondary" onClick={load}>{tr('إعادة المحاولة', 'Try again')}</button>
          <button className="btn btn-primary" onClick={() => openLink(channelUrl)}>{tr('فتح القناة', 'Open the channel')}</button>
        </div>
      )}

      {!data && !error && (
        <div className="proofs-list">
          {[0, 1].map((i) => <div key={i} className="card proof-card proof-skeleton" />)}
        </div>
      )}

      {data && posts.length === 0 && !error && (
        <div className="card ex-empty">
          <div style={{ fontSize: 40 }}>📭</div>
          <p>{tr('ماكو منشورات بعد.', 'No posts yet.')}</p>
          <button className="btn btn-primary" onClick={() => openLink(channelUrl)}>{tr('فتح القناة', 'Open the channel')}</button>
        </div>
      )}

      <div className="proofs-list">
        {posts.map((p) => (
          <PostCard key={p.id} post={p} isAdmin={isAdmin} onHide={(id) => void hide(id)} onZoom={setZoom} />
        ))}
      </div>

      {data?.hasMore && (
        <button className="btn btn-secondary" disabled={loadingMore} onClick={() => void more()}>
          {loadingMore ? tr('يتم التحميل...', 'Loading...') : tr('عرض منشورات أقدم', 'Show older posts')}
        </button>
      )}

      {zoom && <ImageViewer src={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}
