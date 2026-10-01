# نقل البوت من Railway إلى Cloudflare (من الصفر)

## شلون راح يشتغل البوت على Cloudflare

البوت مو موقع بسيط. هو يشتغل طول الوقت:

- يستلم رسائل تيليجرام بشكل مستمر (polling).
- يشغّل مهام كل دقيقة: انتهاء الجوائز، التذكيرات، تذاكر الوساطة.
- يبقى متصل بحساب التسليم.

لهذا ما ينفع Cloudflare Workers العادي (هذا يشتغل بس وقت يجي طلب ويطفى). استعملنا
**Cloudflare Containers**: Cloudflare يبني نفس الـ `Dockerfile` اللي كان يشتغل على Railway
ويشغّله نسخة وحدة شغّالة 24 ساعة. الكود والقاعدة (MongoDB) نفسهن، وما تخسر أي بيانات.

الملفات الجديدة كلها بمجلد `cloudflare/`:

| الملف | شنو يسوي |
|---|---|
| `cloudflare/wrangler.jsonc` | إعدادات Cloudflare: اسم الـ Worker، الـ Dockerfile، نوع الجهاز، نسخة وحدة، Cron كل دقيقتين |
| `cloudflare/src/index.ts` | الـ Worker: يوصّل كل الطلبات للبوت، ويشغّله إذا وقف، ويعيد تشغيله إذا غيّرت الإعدادات |
| `cloudflare/package.json` + `package-lock.json` | المكتبات اللي يحتاجها الـ Worker |

---

## الكلفة (مهم قبل ما تبدي)

- Containers تحتاج **خطة Workers Paid** = **5$ بالشهر** (تحتاج بطاقة دفع: Visa أو MasterCard).
- البوت شغّال 24 ساعة على جهاز `basic` (1GB رام):
  - الذاكرة تقريباً **6$ بالشهر**.
  - المعالج يتحاسب بس على الاستعمال الفعلي، فيطلع قليل.
- **المجموع تقريباً 11–14$ بالشهر.**

---

## الخطوة 1: GitHub (المستودع)

الكود موجود هسه بمستودعك `omarjihad/telegram-roulette-bot` على الفرع
`claude/railway-request-aborted-800rgv`. إذا تريد تستعمله مثل ما هو، **روح للخطوة 2**.

إذا تريد مستودع جديد من الصفر:

1. افتح https://github.com وسجّل دخول (أو **Sign up** وسوّ حساب بالإيميل).
2. فوگ يمين اضغط **+** ← **New repository**.
3. **Repository name**: مثلاً `mf-roulette-bot`. اختار **Private**، وبعدها **Create repository**.
4. بالصفحة الجديدة اضغط **uploading an existing file**.
5. فك ضغط `roulette-bot.zip` بجهازك، وادخل لمجلد `roulette-bot`.
6. اسحب **كل اللي داخله** للصفحة، ومن ضمنها مجلد `cloudflare` وملف `Dockerfile`. لا تسحب المجلد نفسه، اسحب محتواه.
7. اضغط **Commit changes**.

> ⚠️ ملف `.dockerignore` يبدي بنقطة وممكن يكون مخفي بجهازك. لازم يترفع هو هم.
> إذا ما طلع، ارفعه بروحه: **Add file ← Create new file**، اسمه `.dockerignore`، والصق محتواه.

---

## الخطوة 2: حساب Cloudflare

1. افتح https://dash.cloudflare.com/sign-up وسوّ حساب بالإيميل، وأكّد الإيميل من الرسالة اللي توصلك.
2. من القائمة اليسار اختار **Workers & Pages** (أو **Compute ← Workers & Pages**).
3. أول مرة راح يطلب منك تختار **subdomain** لـ `workers.dev`، مثلاً `mfbot`.
   رابط البوت راح يصير: `https://mf-roulette-bot.mfbot.workers.dev`.
4. فعّل الخطة المدفوعة: **Workers & Pages ← Plans** (أو **Manage account ← Billing ← Subscriptions**)
   ← اختار **Workers Paid** (5$) وضيف البطاقة.

---

## الخطوة 3: ربط المستودع وأول نشر

1. **Workers & Pages ← Create ← Import a repository**.
2. **Connect GitHub**، وانطي Cloudflare صلاحية على المستودع.
3. اختار المستودع، وعبّي الإعدادات حرفياً:

| الحقل | القيمة |
|---|---|
| **Project name** | `mf-roulette-bot` (لازم نفس الاسم بالضبط، لأنه مكتوب بـ `wrangler.jsonc`) |
| **Production branch** | الفرع اللي بيه الكود (`claude/railway-request-aborted-800rgv` أو `main`) |
| **Root directory** (بـ Advanced / Build settings) | `cloudflare` |
| **Build command** | اتركه فارغ |
| **Deploy command** | `npx wrangler deploy` |

4. اضغط **Deploy**. أول بناء ياخذ 5–15 دقيقة لأنه يبني صورة Docker كاملة. تگدر تتابعه من تبويب **Deployments / Builds**.
5. بعد ما يخلص افتح الرابط. راح تطلعلك صفحة **«⚙️ البوت يحتاج إعدادات»**. هذا طبيعي، لأنك بعدك ما حطيت الأسرار.

---

## الخطوة 4: الأسرار (Secrets): وين تحطها بالضبط

**Workers & Pages ← mf-roulette-bot ← Settings ← Variables and Secrets ← + Add**

لكل وحدة:

1. **Type** = **Secret**.
2. **Variable name** = الاسم بالضبط مثل الجدول.
3. **Value** = القيمة.
4. **Save** أو **Deploy**.

> انسخ القيم من Railway: الخدمة ← **Variables** ← **Raw Editor**. يطلعلك كلشي مرة وحدة.

| الاسم | القيمة | ضروري؟ |
|---|---|---|
| `BOT_TOKEN` | توكن البوت من @BotFather (نفس اللي بـ Railway) | ✅ |
| `MONGODB_URI` | رابط MongoDB (نفسه) | ✅ |
| `SESSION_SECRET` | **نفس القيمة اللي بـ Railway حرفياً**. إذا تغيّرت ينقطع حساب التسليم | ✅ |
| `OWNER_ID` | آيدي حسابك بتيليجرام (نفسه) | ✅ |
| `MINI_APP_URL` | رابط Cloudflare الجديد، مثل `https://mf-roulette-bot.mfbot.workers.dev` | ✅ |
| `BOT_USERNAME` | `MfRuLiTbot` | ✅ |
| `MINI_APP_SHORT_NAME` | `MFR` | ✅ |
| `GAMEPLAY_ENABLED` | `true` | ✅ |
| `BOT_POLLING_ENABLED` | أول شي `false`، وبعد ما توقف Railway تصير `true` (شوف الخطوة 5) | ✅ |
| `BACKGROUND_JOBS_ENABLED` | أول شي `false`، وبعدين `true` | ✅ |
| `ADSGRAM_REWARD_KEY` | مفتاح مكافأة Adsgram (نفس اللي بـ Railway) | مستحسن |
| `DELIVERY_API_ID` | من my.telegram.org (نفسه) | إذا تستعمل حساب التسليم |
| `DELIVERY_API_HASH` | من my.telegram.org (نفسه) | إذا تستعمل حساب التسليم |
| `SUPPORT_USERNAME`، `DELIVERY_CONTACT_USERNAME`، `ESCALATION_GROUP_USERNAME` | بس إذا جانت موجودة بـ Railway | اختياري |

بعد ما تحفظ الأسرار، خلال دقيقتين الـ Cron يشغّل البوت تلقائياً. وكل ما تغيّر سر بعدين، البوت ينعاد تشغيله وحده خلال دقيقتين.

**MongoDB Atlas:** Cloudflare ما عنده IP ثابت، فلازم بـ Atlas:
**Network Access ← Add IP Address ← Allow Access from Anywhere (`0.0.0.0/0`)**.
إذا جان Railway شغّال قبل، غالباً هذا مضبوط من قبل.

---

## الخطوة 5: الانتقال بدون ما يتعارض البوتين (بالترتيب)

ما يصير نسختين يستلمن رسائل تيليجرام بنفس الوقت. لهذا الترتيب مهم:

1. **تأكد إن Cloudflare شغّال:** افتح `https://<رابطك>/api/healthz`. لازم يطلع `"databaseConnected":true`.
   (أول تشغيل ياخذ دقيقة أو اثنين. إذا طلع «البوت يشتغل الآن» انتظر وحدّث.)
2. **أوقف Railway:** الخدمة ← **Settings** ← انزل لتحت ← احذف الخدمة (**Delete Service**) أو أوقف الـ Deployment.
   تأكد قبلها إنك نسخت المتغيرات.
3. **فعّل البوت على Cloudflare:** غيّر `BOT_POLLING_ENABLED` إلى `true`، و`BACKGROUND_JOBS_ENABLED` إلى `true`. خلال دقيقتين البوت يرد.
4. **BotFather:** `/myapps` ← `@MfRuLiTbot` ← `MFR` ← **Edit Web App URL** ← حط رابط Cloudflare الجديد.
   زر القائمة (Menu Button) البوت يحدّثه وحده.
5. **Adsgram:** غيّر **Reward URL** للرابط الجديد (نفس الشكل، بس الدومين جديد):
   `https://<رابطك>/api/adsgram/reward?userid=[userId]&key=<ADSGRAM_REWARD_KEY>`
   وإذا Adsgram طالب رابط التطبيق، حدّثه هم.
6. **جرّب:** اكتب `/start` بالبوت، افتح التطبيق، وادخل لوحة المطور.
7. **أطفي وضع الصيانة** من لوحة المطور.

---

## بعدين: التحديثات

أي تغيير ينرفع على الفرع المربوط، Cloudflare يبنيه وينشره تلقائياً. البوت يرجع خلال دقيقة أو اثنين بعد كل نشر.

## اللوگات (Logs)

- **Workers & Pages ← mf-roulette-bot ← Logs / Observability**: لوگات الـ Worker والـ Cron.
- قسم **Containers** باللوحة: حالة البوت ولوگاته.

## مشاكل محتملة وحلها

| اللي يطلع | السبب والحل |
|---|---|
| صفحة «البوت يحتاج إعدادات» | سر ناقص من الأربعة الضرورية. ضيفه بالخطوة 4 |
| «البوت يشتغل الآن، حاول بعد دقيقة» | البوت يقلع. انتظر دقيقة. إذا ضلّت، شوف لوگات Containers |
| `databaseConnected: false` | `MONGODB_URI` غلط، أو Atlas ما سامح لـ `0.0.0.0/0` |
| لوگ `409 Conflict: terminated by other getUpdates` | نسخة ثانية (Railway) بعدها شغّالة. أوقفها |
| البناء فشل وبي `Project name` | اسم المشروع لازم يكون `mf-roulette-bot` |
| حساب التسليم انقطع | `SESSION_SECRET` مو نفس قيمة Railway. صحّحه، أو سجّل دخول الحساب من جديد من اللوحة |
