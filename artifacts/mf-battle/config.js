// MF Battle settings. The only thing to change: the address of the roulette bot's server
// on Railway (the same address the Mini App opens), without a trailing slash.
window.MF_BATTLE_CONFIG = {
  // Served by the bot itself (…railway.app/mf-battle) → same server, nothing to set.
  // Uploaded somewhere else (Cloudflare) → the bot's Railway address.
  apiBase: location.pathname.startsWith('/mf-battle') ? location.origin : 'https://telegram-roulette-bot-production-d10e.up.railway.app',
  // Optional: Adsgram blocks just for this site (otherwise the bot's reward block is used).
  // rewardBlockId: '',
  // interstitialBlockId: 'int-52362',
};
