// Adsgram ads (https://adsgram.ai). showAd(blockId) resolves once the ad was watched
// and rejects with a readable message when there is no ad or it was skipped.
// Note: Adsgram blocks only work on the platform whose app URL is this site's address.

const SDK = 'https://sad.adsgram.ai/js/sad.min.js';
let loading = null;

function loadSdk() {
  if (window.Adsgram) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { loading = null; reject(new Error('تعذّر تحميل الإعلانات')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export async function showAd(blockId, { demo = false } = {}) {
  if (demo) return new Promise((r) => setTimeout(r, 500));
  if (!blockId) throw new Error('الإعلانات مو مفعّلة حالياً');
  await loadSdk();
  const ctl = window.Adsgram.init({ blockId: String(blockId) });
  const res = await ctl.show().catch((e) => { throw new Error((e && e.description) || 'ما اكو إعلان هسه، جرّب بعد شوية'); });
  if (res && res.done === false) throw new Error('لازم تكمل الإعلان');
  return res;
}
