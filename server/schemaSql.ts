export const SUPABASE_SCHEMA_SQL = `-- ==============================================================================
-- LOVA MINING — COMPLETE SUPABASE POSTGRESQL SCHEMA
-- Run this script in the Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. USERS
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  photo_url TEXT,
  referral_code TEXT NOT NULL UNIQUE,
  referred_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  available_balance NUMERIC(24, 6) NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  pending_balance NUMERIC(24, 6) NOT NULL DEFAULT 0 CHECK (pending_balance >= 0),
  total_earned NUMERIC(24, 6) NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
  total_withdrawn NUMERIC(24, 6) NOT NULL DEFAULT 0 CHECK (total_withdrawn >= 0),
  streak_days INTEGER NOT NULL DEFAULT 0 CHECK (streak_days >= 0),
  last_checkin_date DATE,
  membership_level INTEGER NOT NULL DEFAULT 1 CHECK (membership_level >= 1),
  membership_updated_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
  ban_reason TEXT,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS membership_level INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS membership_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON public.users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON public.users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON public.users(referred_by_user_id);
CREATE INDEX IF NOT EXISTS idx_users_total_earned_desc ON public.users(total_earned DESC);

-- 2. USER WALLETS (TON Connect & 0.05 GRAM KYC)
CREATE TABLE IF NOT EXISTS public.user_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  raw_address TEXT NOT NULL,
  wallet_provider TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, raw_address)
);

CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id ON public.user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_raw_address ON public.user_wallets(raw_address);

-- 3. WALLET VERIFICATIONS (0.05 GRAM Jetton KYC Fee Ledger)
CREATE TABLE IF NOT EXISTS public.wallet_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  wallet_id UUID REFERENCES public.user_wallets(id) ON DELETE SET NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  sender_address TEXT NOT NULL,
  recipient_address TEXT NOT NULL,
  jetton_master_address TEXT NOT NULL,
  amount_raw TEXT NOT NULL,
  amount_display NUMERIC(24, 9) NOT NULL,
  decimals INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('pending', 'verified', 'rejected')),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_verifications_tx_hash ON public.wallet_verifications(tx_hash);
CREATE INDEX IF NOT EXISTS idx_wallet_verifications_user_id ON public.wallet_verifications(user_id);

-- 4. MINING SESSIONS (Server-timestamp authoritative)
CREATE TABLE IF NOT EXISTS public.mining_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reward_rate_per_sec NUMERIC(18, 8) NOT NULL CHECK (reward_rate_per_sec >= 0),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  max_reward NUMERIC(24, 6) NOT NULL CHECK (max_reward >= 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  stopped_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  claimed_amount NUMERIC(24, 6) NOT NULL DEFAULT 0 CHECK (claimed_amount >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped', 'expired', 'claimed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mining_sessions_user_status ON public.mining_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_mining_sessions_ends_at ON public.mining_sessions(ends_at);

-- 5. MINING REWARDS
CREATE TABLE IF NOT EXISTS public.mining_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.mining_sessions(id) ON DELETE SET NULL,
  reward_type TEXT NOT NULL DEFAULT 'session_claim' CHECK (reward_type IN ('session_claim', 'daily_bonus', 'streak_bonus')),
  amount NUMERIC(24, 6) NOT NULL CHECK (amount > 0),
  is_demo_balance BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mining_rewards_user_created ON public.mining_rewards(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mining_rewards_created ON public.mining_rewards(created_at DESC);

-- 6. REFERRALS (Multi-level tracking)
CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level IN (1, 2)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_referral CHECK (referrer_user_id <> referred_user_id),
  UNIQUE(referred_user_id, level)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(referrer_user_id, level);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON public.referrals(referred_user_id);

-- 7. REFERRAL REWARDS
CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL CHECK (level IN (1, 2)),
  reward_source TEXT NOT NULL CHECK (reward_source IN ('signup_fixed', 'mining_commission')),
  amount NUMERIC(24, 6) NOT NULL CHECK (amount > 0),
  source_session_id UUID REFERENCES public.mining_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON public.referral_rewards(referrer_user_id, created_at DESC);

-- 8. DAILY CHECKINS
CREATE TABLE IF NOT EXISTS public.daily_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  checkin_date DATE NOT NULL,
  streak_day INTEGER NOT NULL CHECK (streak_day >= 1),
  reward_amount NUMERIC(24, 6) NOT NULL CHECK (reward_amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_checkins_user_date ON public.daily_checkins(user_id, checkin_date DESC);

-- 9. TASKS
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('telegram_channel', 'social_link', 'referral_milestone', 'wallet_verified', 'mining_sessions', 'ads_code', 'custom')),
  reward_amount NUMERIC(24, 6) NOT NULL CHECK (reward_amount > 0),
  action_url TEXT,
  telegram_chat_id TEXT,
  required_count INTEGER NOT NULL DEFAULT 1,
  verification_code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. TASK COMPLETIONS
CREATE TABLE IF NOT EXISTS public.task_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  reward_amount NUMERIC(24, 6) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed')),
  verification_meta JSONB DEFAULT '{}'::jsonb,
  UNIQUE(user_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_completions_user ON public.task_completions(user_id, status);

-- 11. WITHDRAWALS
CREATE TABLE IF NOT EXISTS public.withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  destination_address TEXT NOT NULL,
  amount NUMERIC(24, 6) NOT NULL CHECK (amount > 0),
  is_demo_request BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Paid')),
  payout_tx_hash TEXT UNIQUE,
  admin_note TEXT,
  reviewed_by_admin_id UUID,
  reviewed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON public.withdrawals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON public.withdrawals(status, created_at DESC);

-- 12. TRANSACTIONS (Unified Audit Ledger)
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tx_type TEXT NOT NULL CHECK (tx_type IN ('mining_claim', 'daily_checkin', 'task_reward', 'referral_bonus', 'withdrawal_request', 'withdrawal_paid', 'withdrawal_refund', 'gram_verification')),
  amount NUMERIC(24, 9) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'LOVA',
  chain_tx_hash TEXT,
  description TEXT NOT NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON public.transactions(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_unique_chain_hash ON public.transactions(chain_tx_hash) WHERE chain_tx_hash IS NOT NULL;

-- 13. APP SETTINGS (Singleton row id=1)
CREATE TABLE IF NOT EXISTS public.app_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  app_name TEXT NOT NULL DEFAULT 'LOVA Mining',
  mining_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  emergency_pause BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
  reward_rate_per_hour NUMERIC(18, 6) NOT NULL DEFAULT 12.000000,
  mining_duration_seconds INTEGER NOT NULL DEFAULT 28800,
  min_claim_amount NUMERIC(18, 6) NOT NULL DEFAULT 0.100000,
  max_reward_per_session NUMERIC(18, 6) NOT NULL DEFAULT 150.000000,
  daily_bonus_amount NUMERIC(18, 6) NOT NULL DEFAULT 25.000000,
  referral_l1_fixed_bonus NUMERIC(18, 6) NOT NULL DEFAULT 50.000000,
  referral_l1_percent NUMERIC(6, 2) NOT NULL DEFAULT 10.00,
  referral_l2_percent NUMERIC(6, 2) NOT NULL DEFAULT 3.00,
  min_withdrawal NUMERIC(18, 6) NOT NULL DEFAULT 500.000000,
  max_withdrawal NUMERIC(18, 6) NOT NULL DEFAULT 50000.000000,
  gram_verification_fee NUMERIC(18, 6) NOT NULL DEFAULT 0.050000,
  admin_ton_wallet_override TEXT,
  admin_lova_wallet_address TEXT,
  lova_jetton_master_address TEXT,
  lova_jetton_decimals INTEGER NOT NULL DEFAULT 9,
  gram_jetton_master_address TEXT,
  gram_jetton_decimals INTEGER NOT NULL DEFAULT 9,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS admin_lova_wallet_address TEXT;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS lova_jetton_master_address TEXT;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS lova_jetton_decimals INTEGER NOT NULL DEFAULT 9;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS gram_jetton_master_address TEXT;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS gram_jetton_decimals INTEGER NOT NULL DEFAULT 9;

-- 14. ADMINS
CREATE TABLE IF NOT EXISTS public.admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT UNIQUE,
  email TEXT UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'moderator' CHECK (role IN ('super_admin', 'finance_admin', 'moderator')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. ADMIN AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id TEXT NOT NULL,
  admin_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON public.admin_audit_logs(created_at DESC);

-- 16. ANNOUNCEMENTS
CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'airdrop' CHECK (category IN ('airdrop', 'update', 'maintenance', 'security')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. MEMBERSHIP LEVELS
CREATE TABLE IF NOT EXISTS public.membership_levels (
  level_number INTEGER PRIMARY KEY CHECK (level_number >= 1),
  name TEXT NOT NULL,
  badge_label TEXT NOT NULL,
  required_lova_amount NUMERIC(24, 6) NOT NULL DEFAULT 0 CHECK (required_lova_amount >= 0),
  mining_multiplier NUMERIC(8, 2) NOT NULL DEFAULT 1.00 CHECK (mining_multiplier >= 1.00),
  daily_bonus_multiplier NUMERIC(8, 2) NOT NULL DEFAULT 1.00 CHECK (daily_bonus_multiplier >= 1.00),
  benefits JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 18. LEVEL UPGRADE REQUESTS
CREATE TABLE IF NOT EXISTS public.level_upgrade_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  from_level INTEGER NOT NULL CHECK (from_level >= 1),
  target_level INTEGER NOT NULL CHECK (target_level > from_level),
  required_lova_amount NUMERIC(24, 6) NOT NULL CHECK (required_lova_amount > 0),
  admin_wallet_address TEXT NOT NULL,
  sender_wallet_address TEXT,
  tx_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  admin_note TEXT,
  reviewed_by_admin_id TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_level_upgrades_user ON public.level_upgrade_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_level_upgrades_status ON public.level_upgrade_requests(status, created_at DESC);

-- RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mining_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mining_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.level_upgrade_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active tasks" ON public.tasks;
CREATE POLICY "Public read active tasks" ON public.tasks FOR SELECT USING (is_active = TRUE);

DROP POLICY IF EXISTS "Public read active announcements" ON public.announcements;
CREATE POLICY "Public read active announcements" ON public.announcements FOR SELECT USING (is_active = TRUE);

DROP POLICY IF EXISTS "Public read app settings" ON public.app_settings;
CREATE POLICY "Public read app settings" ON public.app_settings FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Public read active membership levels" ON public.membership_levels;
CREATE POLICY "Public read active membership levels" ON public.membership_levels FOR SELECT USING (is_active = TRUE);

-- SEED DATA
INSERT INTO public.app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.membership_levels (
  level_number, name, badge_label, required_lova_amount, mining_multiplier, daily_bonus_multiplier, benefits, is_active
)
VALUES
  (1, 'Starter Miner', 'LVL 1', 0, 1.00, 1.00, '["Standard 1.0x mining speed", "Base daily check-in streak rewards", "Standard withdrawal queue"]'::jsonb, TRUE),
  (2, 'Bronze Rig', 'LVL 2', 500, 1.25, 1.10, '["+25% Mining Speed & Session Cap (1.25x)", "+10% Daily Check-In Bonus", "Bronze Miner profile badge"]'::jsonb, TRUE),
  (3, 'Silver Cluster', 'LVL 3', 2000, 1.60, 1.25, '["+60% Mining Speed & Session Cap (1.60x)", "+25% Daily Check-In Bonus", "Priority withdrawal review queue"]'::jsonb, TRUE),
  (4, 'Gold Validator', 'LVL 4', 5000, 2.20, 1.40, '["+120% Mining Speed & Session Cap (2.20x)", "+40% Daily Check-In Bonus", "VIP fast-track TON payouts"]'::jsonb, TRUE),
  (5, 'Diamond Sovereign', 'LVL 5', 15000, 3.00, 1.75, '["+200% Mining Speed & Session Cap (3.00x)", "+75% Daily Check-In Bonus", "Top-tier Diamond Sovereign status & priority support"]'::jsonb, TRUE)
ON CONFLICT (level_number) DO NOTHING;

INSERT INTO public.announcements (title, body, category, is_active)
VALUES
  ('LOVA Live Token Mining on TON Network', 'Mine LOVA directly in Worker Mode. Connect your TON wallet and complete 0.05 GRAM KYC verification to unlock live withdrawal requests.', 'airdrop', TRUE),
  ('0.05 GRAM KYC Wallet Verification Required', 'Before submitting any LOVA withdrawal request, workers must verify wallet ownership with an on-chain 0.05 GRAM Jetton transfer to the Admin TON wallet.', 'security', TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO public.tasks (title, description, category, reward_amount, action_url, required_count, is_active, sort_order)
VALUES
  ('Complete 0.05 GRAM Wallet KYC Verification', 'Connect your TON wallet and complete the on-chain 0.05 GRAM Jetton transfer verification.', 'wallet_verified', 250, NULL, 1, TRUE, 1),
  ('Invite 3 Friends to LOVA Mining', 'Share your unique referral link and onboard 3 active miners.', 'referral_milestone', 300, NULL, 3, TRUE, 2),
  ('Complete 5 Mining Sessions', 'Finish and claim rewards from 5 server-verified mining sessions.', 'mining_sessions', 150, NULL, 5, TRUE, 3),
  ('Join Official LOVA Telegram Channel', 'Join our official Telegram channel for TON Jetton deployment updates.', 'telegram_channel', 100, 'https://t.me/LovaMiningOfficial', 1, TRUE, 4)
ON CONFLICT DO NOTHING;
`;
