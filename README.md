# HESABDAR-V2

نسخهٔ اصلاح‌شده و امن‌تر نرم‌افزار حسابداری **HESABDAR** با پشتیبانی آنلاین + آفلاین (همگام‌سازی هنگام وصل شدن).

> ریپازیتوری اصلی `HESABDAROFFLINE` دست‌نخورده مانده است. همهٔ تغییرات فقط در این ریپوی جدا (`HESABDAR-V2`) هستند.

## قابلیت‌ها

- حسابداری چندنقشی (حسابدار / فروشنده / ناظر) با PIN هش‌شده (scrypt)
- محدودیت نرخ روی تغییر نقش (ضد brute-force)
- PWA + Service Worker برای باز شدن آفلاین
- صف همگام‌سازی (outbox) در IndexedDB؛ پس از آنلاین شدن خودکار ارسال می‌شود
- سیاست تعارض حسابداری: اسناد ثبت‌شده بازنویسی نمی‌شوند
- خروجی Excel با `exceljs` (بدون وابستگی آسیب‌پذیر `xlsx`)
- آماده‌سازی برای استقرار روی Vercel + Postgres (Neon/Supabase) + ایمیل Resend

## پیش‌نیاز

- Node.js 22+
- حساب GitHub (همین ریپو)
- برای تولید: Neon یا Supabase، Vercel، Resend

## راه‌اندازی محلی

```bash
cp .env.example .env
npm install
npm run dev
```

اپ روی `http://localhost:8080` بالا می‌آید. بدون `DATABASE_URL` از PGLite محلی استفاده می‌شود.

### اسکریپت‌های مهم

| دستور | کار |
|---|---|
| `npm run dev` | توسعه |
| `npm run typecheck` | تایپ |
| `npm run lint` | لینت |
| `npm test` | تست واحد/یکپارچگی |
| `npm run build` | بیلد + مایگریشن |
| `npm run test:e2e` | دود Playwright (پس از بیلد/پیشنمایش) |

## متغیرهای محیطی

همه در `.env.example` توضیح داده شده‌اند. حیاتی‌ها:

- `DATABASE_URL` — Postgres تولید
- `BETTER_AUTH_SECRET` — رمز تصادفی بلند
- `BETTER_AUTH_URL` / `APP_URL` — آدرس عمومی اپ
- `VITE_AUTH_ENABLED=true` — روشن کردن احراز هویت
- `RESEND_API_KEY` + `ROLE_MAIL_FROM` — ایمیل بازنشانی رمز نقش / تأیید
- `GROK_AUTH_CLIENT_ID` / `GROK_AUTH_CLIENT_SECRET` — اختیاری برای OAuth

**هرگز** سکرت را در گیت commit نکنید.

## استقرار مرحله‌به‌مرحله (Vercel + Neon + Resend)

1. **Neon**: پروژه بسازید → Connection string را کپی کنید → در Vercel به‌عنوان `DATABASE_URL`.
2. **Resend**: API Key بسازید و دامنه را verify کنید → `RESEND_API_KEY` و `ROLE_MAIL_FROM`.
3. **Vercel**: Import همین ریپو → Framework Vite → Envها را از `.env.example` پر کنید → Deploy.
4. `BETTER_AUTH_URL` و `APP_URL` را روی دامنه نهایی Vercel بگذارید و دوباره Deploy کنید.
5. ثبت‌نام/ورود را تست کنید و یک رمز نقش ۴ رقمی تنظیم کنید.

جزئیات معماری برای ویرایش بعدی در چت: فایل `AGENTS.md`.

## طراحی آفلاین / همگام‌سازی

- درخواست‌های ذخیرهٔ فاکتور/پرداخت هنگام قطع اینترنت در IndexedDB صف می‌شوند.
- هدر `Authorization` در صف ذخیره **نمی‌شود**؛ از کوکی httpOnly استفاده می‌شود.
- هنگام آنلاین شدن، صف به‌ترتیب ارسال می‌شود.
- اگر سرور نسخهٔ جدیدتر/ثبت‌شده داشته باشد (409)، نسخهٔ سرور می‌ماند.
- وضعیت «آنلاین / آفلاین / در حال همگام‌سازی / صف» در نوار اپ به فارسی دیده می‌شود.

## امنیت (خلاصه اصلاحات V2)

- PIN نقش‌ها با scrypt هش می‌شود (حداقل طول همچنان ۴ رقم طبق درخواست کاربر)
- Rate limit روی `changeRole` / reset
- سکرت OAuth پیش‌نمایش از env خوانده می‌شود (دیگر در کد ثابت نیست)
- توکن نقش با انقضای ۱۲ ساعته + کوکی httpOnly
- `.gitignore` کامل برای `.data` / `.vercel` / attachments
- ارتقای `better-auth` و جایگزینی `xlsx` با `exceljs`

## بکاپ خودکار دیتابیس (GitHub Actions + Neon)

هر شب حدود **۰۲:۰۰ به وقت کابل** (و همچنین با اجرای دستی) workflow به نام `DB Backup` یک `pg_dump` رمزگذاری‌شده از Postgres می‌گیرد و تا ۳۰ روز به‌صورت Artifact نگه می‌دارد.

### راه‌اندازی یک‌باره

در GitHub → Settings → Secrets and variables → Actions این دو سکرت را بگذارید:

| Secret | مقدار |
|---|---|
| `DATABASE_URL` | همان Connection string نئون (ترجیحاً نقش فقط‌خواندنی برای بکاپ) |
| `BACKUP_PASSPHRASE` | یک عبارت عبور بلند و تصادفی برای رمز gpg |

اگر سکرت‌ها نباشند، workflow با پیام واضح **رد می‌شود و fail نمی‌شود**.

فایل workflow: `.github/workflows/db-backup.yml`

### بازیابی از بکاپ (فارسی)

1. در تب **Actions** → workflow **DB Backup** → آخرین اجرای موفق → بخش Artifacts را باز کنید و فایل `hesabdar-….dump.gpg` را دانلود کنید.
2. روی کامپیوتر خودتان رمزگشایی کنید:

```bash
gpg --batch --yes --pinentry-mode loopback \
  --passphrase 'YOUR_BACKUP_PASSPHRASE' \
  --decrypt -o hesabdar.dump hesabdar-YYYYMMDD.dump.gpg
```

3. به یک دیتابیس خالی Neon / Postgres بازیابی کنید:

```bash
pg_restore --no-owner --no-acl -d "$DATABASE_URL" hesabdar.dump
```

4. فایل‌های `.dump` و عبارت عبور را امن نگه دارید؛ Artifactها فقط ۳۰ روز می‌مانند.

> توجه: `pg_restore` روی دیتابیس در حال استفاده ممکن است تداخل ایجاد کند. برای بازیابی کامل معمولاً دیتابیس خالی یا شاخهٔ جدید Neon بسازید.

