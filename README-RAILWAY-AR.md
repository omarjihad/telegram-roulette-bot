# التشغيل على Railway

## مشكلة "This service has been suspended by its owner"

هاي الرسالة **مو من Railway**، هاي صفحة Render. معناها رابط الـ Mini App المسجّل بـ BotFather
بعده يأشّر على السيرفر القديم مال Render (اللي انوقف).

روابط الدعوة شكلها `https://t.me/MfRuLiTbot/MFR?startapp=...`، وهاي تفتح الـ Mini App اللي
اسمه `MFR` بـ BotFather مباشرة، فتفتح الرابط القديم.

### الحل (مرة وحدة بس)

1. افتح [@BotFather](https://t.me/BotFather) واكتب `/myapps`.
2. اختار البوت `@MfRuLiTbot` ← التطبيق `MFR`.
3. اضغط **Edit Web App URL** وحط رابط Railway، مثلاً `https://xxxx.up.railway.app`.
4. (اختياري) `/mybots` ← البوت ← **Bot Settings** ← **Menu Button** ← حط نفس الرابط.
   البوت هسه يحدّث زر القائمة تلقائياً عند التشغيل إذا `MINI_APP_URL` معبّى.

## متغيرات Railway (Variables)

- `BOT_TOKEN`، `MONGODB_URI`، `SESSION_SECRET`، `OWNER_ID`
- `MINI_APP_URL` = رابط Railway مالتك (لازم يبدي بـ `https://`)
- `BOT_USERNAME` = `MfRuLiTbot`
- `MINI_APP_SHORT_NAME` = `MFR`
- `GAMEPLAY_ENABLED=true`، `BOT_POLLING_ENABLED=true`، `BACKGROUND_JOBS_ENABLED=true`
- `DELIVERY_API_ID` و`DELIVERY_API_HASH` (اختياري)

Railway يقرأ الـ `Dockerfile` تلقائياً ويحقن `PORT`. تأكد من **Settings ← Networking ← Generate Domain**.

> تأكد إن خدمة Render مطفية/محذوفة، لأن إذا رجعت تشتغل بنفس `BOT_TOKEN` راح يصير تعارض polling.

## عن لوجات `request aborted`

طبيعية: تصير لما المستخدم يسد الـ Mini App قبل ما يخلص الطلب. مو هي سبب المشكلة.
