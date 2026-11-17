# LOVA Mining — Live TON Telegram Mining Mini App

**Tagline:** Mine Today, Earn Tomorrow  
**Token:** LOVA (`LOVA`) · Live Jetton on the TON Network  
**Architecture:** Two strictly separated portals:
- **Part 1 — Worker Mode (`/`):** Telegram Mini App for miners (Mining Core, Referrals, Tasks, Leaderboard, TON Wallet, live TON/LOVA/GRAM balances, 0.05 GRAM KYC verification, and KYC-gated withdrawals). Zero admin links or developer panels are shown in Worker Mode.
- **Part 2 — Admin Panel Mode (`/admin`):** Independent administrative console for managing TON/Jetton contracts (`LOVA` & `GRAM`), mining rates, tasks/Ads codes, user moderation, Telegram bot/webhook sync, and on-chain verified payouts.

---

## Mandatory 0.05 GRAM Wallet KYC

Workers must connect their TON wallet via **TON Connect** and complete an on-chain **0.05 GRAM Jetton** transfer to `ADMIN_TON_WALLET_ADDRESS` before withdrawal requests are unlocked. Both the UI and backend API enforce this KYC requirement.

---

## 1. Supabase PostgreSQL Setup (Required for Cloudflare Production)

Cloudflare Workers/Pages Functions are stateless at the edge, so Supabase PostgreSQL stores all users, balances, sessions, KYC verifications, and withdrawals:

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New Query**, paste the contents of `supabase/schema.sql`, and run it.
3. Copy **Project URL** and **Service Role Key** from **Project Settings → API**.
4. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as secrets in Cloudflare (never expose `SUPABASE_SERVICE_ROLE_KEY` to client code).

---

## 2. GitHub + Cloudflare Pages Deployment (Recommended)

This repository includes native Cloudflare Pages Functions (`functions/api/[[route]].ts` and `functions/tonconnect-manifest.json.ts`) backed by `server/edgeEngine.ts` plus GitHub Actions CI/CD (`.github/workflows/deploy-cloudflare.yml`).

### Option A: Automatic Git Integration in Cloudflare Dashboard
1. Push this repository to **GitHub**.
2. In **Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git**, select your repository.
3. Set build configuration:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Under **Settings → Functions → Compatibility flags**, ensure `nodejs_compat` is enabled (also configured in `wrangler.toml`).
5. Under **Settings → Environment variables (Production)**, add your server secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_BOT_USERNAME`
   - `TELEGRAM_ALLOW_DEV_PREVIEW` = `"false"`
   - `SESSION_SECRET` (random 32+ char hex)
   - `ADMIN_BOOTSTRAP_SECRET` (random 32+ char hex)
   - `ADMIN_TELEGRAM_IDS` (comma-separated numeric Telegram IDs)
   - `LOVA_JETTON_MASTER_ADDRESS`, `LOVA_JETTON_DECIMALS` (`9`)
   - `GRAM_JETTON_MASTER_ADDRESS`, `GRAM_JETTON_DECIMALS` (`9`)
   - `ADMIN_TON_WALLET_ADDRESS` (0.05 GRAM KYC receiving wallet)
   - `ADMIN_LOVA_WALLET_ADDRESS` (Official Admin LOVA receiving wallet for Membership Level Upgrades)
   - `TON_API_ENDPOINT` = `"https://tonapi.io/v2"`
   - `TON_API_KEY`
6. Save and redeploy! Your Worker App is live at `https://<your-project>.pages.dev/` and your Admin Panel is at `https://<your-project>.pages.dev/admin`.

### Option B: GitHub Actions Auto-Deploy
The included `.github/workflows/deploy-cloudflare.yml` runs `npm run lint` and `npm run build` on every push/PR to `main`. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to your GitHub repository Secrets (and optionally `CF_PAGES_PROJECT` to Variables) to auto-deploy on push to `main`.

### Option C: Cloudflare Workers Static Assets (`wrangler.worker.toml`)
If you prefer a standalone Cloudflare Worker instead of Pages:
```bash
npm run build
npx wrangler deploy -c wrangler.worker.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY -c wrangler.worker.toml
```

---

## 3. Telegram Bot & Mini App Sync

1. Open [@BotFather](https://t.me/BotFather) and create or select your bot.
2. Open `https://<your-domain>/admin` and sign in with `ADMIN_BOOTSTRAP_SECRET` (or your authorized Telegram ID).
3. Go to **Bot & Setup**, confirm your public HTTPS URL, and click **Connect & Sync Telegram Bot**.
4. Use **Check Webhook Health** to verify Telegram can reach `https://<your-domain>/api/telegram/webhook`.

---

## 4. Local Development

```bash
npm install
npm run dev       # Express + Vite dev server on http://localhost:3000 (Worker: /, Admin: /admin)
npm run lint      # TypeScript check
npm run build     # Build production dist/
npm run start     # Production Node server
```
