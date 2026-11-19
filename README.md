# LOVA Mining — Live TON Telegram Mining Mini App

**Tagline:** Mine Today, Earn Tomorrow  
**Token:** LOVA (`LOVA`) · Live Jetton on the TON Network  
**Database:** Cloudflare D1 (SQLite at the Edge)  
**Architecture:** Two strictly separated portals:
- **Part 1 — Worker Mode (`/`):** Telegram Mini App for miners (Mining Core, Referrals, Tasks, Membership Level Up, Leaderboard, TON Wallet, live TON/LOVA/GRAM balances, 0.05 GRAM KYC verification, and KYC-gated withdrawals). Zero admin links or developer panels are shown in Worker Mode.
- **Part 2 — Admin Panel Mode (`/admin`):** Independent administrative console for managing TON/Jetton contracts (`LOVA` & `GRAM`), mining rates, Membership Level Up payment verification, tasks/Ads codes, user moderation, Telegram bot/webhook sync, and on-chain verified payouts.

---

## Mandatory 0.05 GRAM Wallet KYC

Workers must connect their TON wallet via **TON Connect** and complete an on-chain **0.05 GRAM Jetton** transfer to `ADMIN_TON_WALLET_ADDRESS` before withdrawal requests are unlocked. Both the UI and backend API enforce this KYC requirement.

---

## 1. Cloudflare D1 Database Setup & Migration (Required)

LOVA Mining stores all users, balances, mining sessions, tasks, referrals, wallet KYC proofs, level-up requests, withdrawals, and admin audit logs directly in **Cloudflare D1 (SQLite)**.

### Step 1: Create the D1 Database
```bash
npx wrangler login
npx wrangler d1 create lova-mining-db
```

### Step 2: Add the Database ID to `wrangler.toml` / `wrangler.worker.toml`
Copy the `database_id` printed by Wrangler into both `wrangler.toml` (for Cloudflare Pages) and `wrangler.worker.toml` (for Cloudflare Workers):
```toml
[[d1_databases]]
binding = "DB"
database_name = "lova-mining-db"
database_id = "<YOUR_D1_DATABASE_ID>"
```

### Step 3: Run the D1 Schema Migration (`schema.sql`)
Apply `schema.sql` to your remote production D1 database (and optionally local Wrangler D1):
```bash
# Production (remote Cloudflare D1):
npx wrangler d1 execute lova-mining-db --remote --file=./schema.sql

# Optional local Wrangler preview:
npx wrangler d1 execute lova-mining-db --local --file=./schema.sql
```
You can also inspect your tables anytime with:
```bash
npx wrangler d1 execute lova-mining-db --remote --command="SELECT name FROM sqlite_master WHERE type='table';"
```

---

## 2. Deployment on Cloudflare Workers or Cloudflare Pages

### Option A: Cloudflare Workers Static Assets (`wrangler.worker.toml`)
1. Build the frontend:
   ```bash
   npm run build
   ```
2. Set your Worker secrets:
   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN -c wrangler.worker.toml
   npx wrangler secret put TELEGRAM_BOT_USERNAME -c wrangler.worker.toml
   npx wrangler secret put SESSION_SECRET -c wrangler.worker.toml
   npx wrangler secret put ADMIN_BOOTSTRAP_SECRET -c wrangler.worker.toml
   npx wrangler secret put ADMIN_TELEGRAM_IDS -c wrangler.worker.toml
   npx wrangler secret put LOVA_JETTON_MASTER_ADDRESS -c wrangler.worker.toml
   npx wrangler secret put GRAM_JETTON_MASTER_ADDRESS -c wrangler.worker.toml
   npx wrangler secret put ADMIN_TON_WALLET_ADDRESS -c wrangler.worker.toml
   npx wrangler secret put ADMIN_LOVA_WALLET_ADDRESS -c wrangler.worker.toml
   npx wrangler secret put TON_API_KEY -c wrangler.worker.toml
   ```
3. Deploy the Worker + Static Assets + D1 binding:
   ```bash
   npm run deploy:worker
   ```

### Option B: Cloudflare Pages + GitHub Integration (`wrangler.toml`)
1. Push this repository to **GitHub**.
2. In **Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git**, select your repository.
3. Set build configuration:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Under **Settings → Functions → D1 database bindings**, bind Variable name `DB` to `lova-mining-db` (also declared in `wrangler.toml`), and ensure Compatibility Flag `nodejs_compat` is enabled.
5. Under **Settings → Environment variables (Production)**, add your server secrets:
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
6. Deploy! Your Worker App is live at `https://<your-project>.pages.dev/` and your Admin Panel is at `https://<your-project>.pages.dev/admin`.

---

## 3. Telegram Bot & Mini App Sync

1. Open [@BotFather](https://t.me/BotFather) and create or select your bot.
2. Open `https://<your-domain>/admin` and sign in with `ADMIN_BOOTSTRAP_SECRET` (or your authorized Telegram ID).
3. Go to **Bot & Setup**, confirm your public HTTPS URL, and click **Connect & Sync Telegram Bot**.
4. Use **Check Webhook Health** to verify Telegram can reach `https://<your-domain>/api/telegram/webhook`.

---

## 4. Local Development (Node SQLite D1 Emulator)

```bash
npm install
npm run dev       # Express + Vite dev server on http://localhost:3000 (auto-creates .data/lova-d1.sqlite)
npm run lint      # TypeScript check
npm run build     # Build production dist/
npm run start     # Production Node server
```
