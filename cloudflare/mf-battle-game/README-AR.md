# سيرفر لعبة MF Battle على Cloudflare

هذا سيرفر الأونلاين، شغّال على Cloudflare (Workers + Durable Objects). تنحط غرفة اللعب قريبة من اللاعبين (الشرق الأوسط)، فالبنك ينزل.

- الغرفة نفسها (`artifacts/mf-battle/room.js`) هي نفس اللي بسيرفر البوت، فالقوانين وحدة.
- تسجيل الدخول، والعملات، واللفل، والترتيب كلها تبقى بسيرفر البوت على Railway. هذا السيرفر يكلمه بمفتاح سري.

## النشر (مرة وحدة)
1. Cloudflare ← **Workers & Pages** ← **Create** ← **Import a repository** ← اختار الريبو.
2. **Root directory:** `cloudflare/mf-battle-game`، و**Deploy command:** `npx wrangler deploy`.
3. بعد أول نشر: **Settings ← Variables and Secrets ← Add ← Secret**:
   `BATTLE_INTERNAL_KEY` = نفس القيمة اللي بـ Railway.
4. بـ Railway ضيف:
   - `BATTLE_INTERNAL_KEY` (نفس القيمة، 24 حرف أو أكثر).
   - `MF_BATTLE_WS_URL` = `wss://mf-battle-game.<اسمك>.workers.dev/ws`

الدليل الكامل بالصور بالـ artifact.
