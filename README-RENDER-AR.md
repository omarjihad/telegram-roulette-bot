# Bounty Rush — نسخة Render Docker

هذه الحزمة هي نسخة نشر كاملة للبوت على Render باستخدام Docker.

## الملفات المهمة

- `Dockerfile` — يبني الواجهة والخادم داخل حاوية واحدة.
- `.dockerignore` — يمنع إرسال `node_modules` والملفات الحساسة إلى Docker.
- `render.yaml` — إعداد Render الجاهز.
- `artifacts/api-server` — الخادم والـ Telegram bot والـ API.
- `artifacts/bounty-roulette` — واجهة Mini App.

## التشغيل على Render

1. ارفع محتويات هذه الحزمة إلى مستودع GitHub جديد.
2. في Render اختر **New + → Blueprint** إذا أردت استخدام `render.yaml`، أو اختر **New Web Service → Existing Repository** وحدد Docker.
3. أضف القيم السرية من إعدادات Render:
   - `BOT_TOKEN`
   - `MONGODB_URI`
   - `SESSION_SECRET`
   - `OWNER_ID`
    - `DELIVERY_API_ID` و`DELIVERY_API_HASH` إذا تريد تفعيل حساب Telegram المستخدم للتسليم.
4. اترك Render يستخدم أمر Docker الافتراضي. لا تضع Start Command آخر.
5. بعد نجاح النشر، ضع رابط Render في إعدادات Mini App داخل BotFather.

## إعداد حساب التسليم

1. أنشئ Telegram API application من `my.telegram.org` وخذ `api_id` و`api_hash`، ثم أضفهما كمتغيري Render باسم `DELIVERY_API_ID` و`DELIVERY_API_HASH`.
2. افتح لوحة المطور داخل الـ Mini App، ثم تبويب **حساب التسليم**.
3. أدخل رقم الهاتف بصيغة دولية، ثم كود Telegram. إذا كان التحقق بخطوتين مفعلاً سيظهر حقل كلمة المرور وتلميحها.
4. بعد نجاح الدخول تُشفّر جلسة الحساب باستخدام `SESSION_SECRET` وتُحفظ في MongoDB. لا تضع session أو رقم هاتف الحساب داخل الكود أو ملفات المشروع.
5. عند مراسلة حساب التسليم، يُسجّل المستخدم كمتحقق ويُضاف كجهة اتصال قدر الإمكان، ثم يستطيع الرجوع للـ Mini App وإرسال طلب الاستلام.

المنفذ يقرأه الخادم من `PORT`، وRender يحقنه تلقائياً. لا تضع أسراراً داخل الملفات أو داخل `render.yaml`.