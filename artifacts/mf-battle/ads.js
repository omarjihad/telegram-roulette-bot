// Adsgram ads (https://adsgram.ai). showAd(blockId) resolves once the ad was watched
// and rejects with a readable message when there is no ad or it was skipped.
//
// Adsgram only serves a block on the domain its platform was registered with (the bot's
// Railway domain). When the game itself runs there, the SDK is used directly. When it
// runs somewhere else (Cloudflare Pages), the ad plays in a full-screen frame loaded from
// the bot's domain (mf-battle/ad.html), so the same platform and blocks still work.

const SDK = 'https://sad.adsgram.ai/js/sad.min.js';
// Telegram calls the ad frame may make (e.g. opening the advertiser's link), passed on to Telegram.
const RELAY = new Set(['web_app_open_link', 'web_app_open_tg_link', 'web_app_trigger_haptic_feedback']);
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

async function showDirect(blockId) {
  await loadSdk();
  const ctl = window.Adsgram.init({ blockId: String(blockId) });
  const res = await ctl.show().catch((e) => { throw new Error((e && e.description) || 'ما اكو إعلان هسه، جرّب بعد شوية'); });
  if (res && res.done === false) throw new Error('لازم تكمل الإعلان');
  return res;
}

function showInFrame(blockId, base, hash) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.className = 'ad-frame';
    frame.allow = 'autoplay; fullscreen; clipboard-write';
    frame.src = `${base}/mf-battle/ad.html#${hash ? `${hash}&` : ''}mfbBlock=${encodeURIComponent(blockId)}`;
    const origin = new URL(base).origin;
    let finished = false;
    const finish = (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      if (err) reject(err); else resolve();
    };
    function onMessage(e) {
      if (e.source !== frame.contentWindow || e.origin !== origin) return;
      const d = e.data;
      if (d && d.mfbAd) { finish(d.mfbAd === 'done' ? null : new Error(d.msg || 'ما اكو إعلان هسه')); return; }
      // Telegram's script inside the frame talks to its parent: hand those calls to Telegram.
      if (typeof d === 'string') {
        try {
          const ev = JSON.parse(d);
          const tgView = window.Telegram && window.Telegram.WebView;
          if (ev && RELAY.has(ev.eventType) && tgView) tgView.postEvent(ev.eventType, false, ev.eventData);
        } catch (err) { /* not a Telegram message */ }
      }
    }
    window.addEventListener('message', onMessage);
    // Nothing back after a minute (frame failed to load): give up quietly.
    const timer = setTimeout(() => finish(new Error('ما اكو إعلان هسه، جرّب بعد شوية')), 60000);
    document.body.appendChild(frame);
  });
}

/** opts: demo (fake ad), base (the bot's address), hash (Telegram launch data for the frame). */
export async function showAd(blockId, { demo = false, base = '', hash = '' } = {}) {
  if (demo) return new Promise((r) => setTimeout(r, 500));
  if (!blockId) throw new Error('الإعلانات مو مفعّلة حالياً');
  const elsewhere = base && new URL(base, location.href).origin !== location.origin;
  return elsewhere ? showInFrame(String(blockId), base.replace(/\/+$/, ''), hash) : showDirect(blockId);
}
