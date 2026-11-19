-- ==============================================================================
-- LOVA MINING — COMPLETE CLOUDFLARE D1 (SQLITE) SCHEMA
-- Apply locally:  npx wrangler d1 execute lova-mining-db --local --file=./schema.sql
-- Apply remotely: npx wrangler d1 execute lova-mining-db --remote --file=./schema.sql
-- ==============================================================================

-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  telegram_id INTEGER NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  photo_url TEXT,
  referral_code TEXT NOT NULL UNIQUE,
  referred_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  available_balance REAL NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  pending_balance REAL NOT NULL DEFAULT 0 CHECK (pending_balance >= 0),
  total_earned REAL NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
  total_withdrawn REAL NOT NULL DEFAULT 0 CHECK (total_withdrawn >= 0),
  streak_days INTEGER NOT NULL DEFAULT 0 CHECK (streak_days >= 0),
  last_checkin_date TEXT,
  membership_level INTEGER NOT NULL DEFAULT 1 CHECK (membership_level >= 1),
  membership_updated_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
  ban_reason TEXT,
  last_active_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by_user_id);
CREATE INDEX IF NOT EXISTS idx_users_total_earned_desc ON users(total_earned DESC);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at);

-- 2. USER WALLETS (TON Connect & 0.05 GRAM KYC)
CREATE TABLE IF NOT EXISTS user_wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  raw_address TEXT NOT NULL,
  wallet_provider TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),
  is_suspended INTEGER NOT NULL DEFAULT 0 CHECK (is_suspended IN (0, 1)),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, raw_address)
);

CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id ON user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_raw_address ON user_wallets(raw_address);

-- 3. WALLET VERIFICATIONS (0.05 GRAM Jetton KYC Fee Ledger)
CREATE TABLE IF NOT EXISTS wallet_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id TEXT REFERENCES user_wallets(id) ON DELETE SET NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  sender_address TEXT NOT NULL,
  recipient_address TEXT NOT NULL,
  jetton_master_address TEXT NOT NULL,
  amount_raw TEXT NOT NULL,
  amount_display REAL NOT NULL,
  decimals INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('pending', 'verified', 'rejected')),
  verified_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_verifications_tx_hash ON wallet_verifications(tx_hash);
CREATE INDEX IF NOT EXISTS idx_wallet_verifications_user_id ON wallet_verifications(user_id);

-- 4. MINING SESSIONS (Server-timestamp authoritative)
CREATE TABLE IF NOT EXISTS mining_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_rate_per_sec REAL NOT NULL CHECK (reward_rate_per_sec >= 0),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  max_reward REAL NOT NULL CHECK (max_reward >= 0),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ends_at TEXT NOT NULL,
  stopped_at TEXT,
  claimed_at TEXT,
  claimed_amount REAL NOT NULL DEFAULT 0 CHECK (claimed_amount >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped', 'expired', 'claimed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_mining_sessions_user_status ON mining_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_mining_sessions_ends_at ON mining_sessions(ends_at);

-- 5. MINING REWARDS
CREATE TABLE IF NOT EXISTS mining_rewards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES mining_sessions(id) ON DELETE SET NULL,
  reward_type TEXT NOT NULL DEFAULT 'session_claim' CHECK (reward_type IN ('session_claim', 'daily_bonus', 'streak_bonus')),
  amount REAL NOT NULL CHECK (amount > 0),
  is_demo_balance INTEGER NOT NULL DEFAULT 0 CHECK (is_demo_balance IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_mining_rewards_user_created ON mining_rewards(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mining_rewards_created ON mining_rewards(created_at DESC);

-- 6. REFERRALS (Multi-level tracking)
CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  referrer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level IN (1, 2)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (referrer_user_id <> referred_user_id),
  UNIQUE(referred_user_id, level)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id, level);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_user_id);

-- 7. REFERRAL REWARDS
CREATE TABLE IF NOT EXISTS referral_rewards (
  id TEXT PRIMARY KEY,
  referrer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL CHECK (level IN (1, 2)),
  reward_source TEXT NOT NULL CHECK (reward_source IN ('signup_fixed', 'mining_commission')),
  amount REAL NOT NULL CHECK (amount > 0),
  source_session_id TEXT REFERENCES mining_sessions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(referrer_user_id, created_at DESC);

-- 8. DAILY CHECKINS
CREATE TABLE IF NOT EXISTS daily_checkins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkin_date TEXT NOT NULL,
  streak_day INTEGER NOT NULL CHECK (streak_day >= 1),
  reward_amount REAL NOT NULL CHECK (reward_amount > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_checkins_user_date ON daily_checkins(user_id, checkin_date DESC);

-- 9. TASKS
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('telegram_channel', 'social_link', 'referral_milestone', 'wallet_verified', 'mining_sessions', 'ads_code', 'custom')),
  reward_amount REAL NOT NULL CHECK (reward_amount > 0),
  action_url TEXT,
  telegram_chat_id TEXT,
  required_count INTEGER NOT NULL DEFAULT 1,
  verification_code TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 10. TASK COMPLETIONS
CREATE TABLE IF NOT EXISTS task_completions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  reward_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed')),
  verification_meta TEXT NOT NULL DEFAULT '{}',
  UNIQUE(user_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_completions_user ON task_completions(user_id, status);

-- 11. WITHDRAWALS
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  destination_address TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  is_demo_request INTEGER NOT NULL DEFAULT 0 CHECK (is_demo_request IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Paid')),
  payout_tx_hash TEXT UNIQUE,
  admin_note TEXT,
  reviewed_by_admin_id TEXT,
  reviewed_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status, created_at DESC);

-- 12. TRANSACTIONS (Unified Audit Ledger)
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tx_type TEXT NOT NULL CHECK (tx_type IN ('mining_claim', 'daily_checkin', 'task_reward', 'referral_bonus', 'withdrawal_request', 'withdrawal_paid', 'withdrawal_refund', 'gram_verification')),
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'LOVA',
  chain_tx_hash TEXT,
  description TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_unique_chain_hash ON transactions(chain_tx_hash) WHERE chain_tx_hash IS NOT NULL;

-- 13. APP SETTINGS (Singleton row id=1)
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  app_name TEXT NOT NULL DEFAULT 'LOVA Mining',
  mining_enabled INTEGER NOT NULL DEFAULT 1 CHECK (mining_enabled IN (0, 1)),
  emergency_pause INTEGER NOT NULL DEFAULT 0 CHECK (emergency_pause IN (0, 1)),
  maintenance_mode INTEGER NOT NULL DEFAULT 0 CHECK (maintenance_mode IN (0, 1)),
  reward_rate_per_hour REAL NOT NULL DEFAULT 12.0,
  mining_duration_seconds INTEGER NOT NULL DEFAULT 28800,
  min_claim_amount REAL NOT NULL DEFAULT 0.1,
  max_reward_per_session REAL NOT NULL DEFAULT 150.0,
  daily_bonus_amount REAL NOT NULL DEFAULT 25.0,
  referral_l1_fixed_bonus REAL NOT NULL DEFAULT 50.0,
  referral_l1_percent REAL NOT NULL DEFAULT 10.0,
  referral_l2_percent REAL NOT NULL DEFAULT 3.0,
  min_withdrawal REAL NOT NULL DEFAULT 500.0,
  max_withdrawal REAL NOT NULL DEFAULT 50000.0,
  gram_verification_fee REAL NOT NULL DEFAULT 0.05,
  admin_ton_wallet_override TEXT,
  admin_lova_wallet_address TEXT,
  lova_jetton_master_address TEXT,
  lova_jetton_decimals INTEGER NOT NULL DEFAULT 9,
  gram_jetton_master_address TEXT,
  gram_jetton_decimals INTEGER NOT NULL DEFAULT 9,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 14. ADMINS
CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  telegram_id INTEGER UNIQUE,
  email TEXT UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'moderator' CHECK (role IN ('super_admin', 'finance_admin', 'moderator')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 15. ADMIN AUDIT LOGS
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  admin_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON admin_audit_logs(created_at DESC);

-- 16. ANNOUNCEMENTS
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'airdrop' CHECK (category IN ('airdrop', 'update', 'maintenance', 'security')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 17. MEMBERSHIP LEVELS (Upgrade Tiers)
CREATE TABLE IF NOT EXISTS membership_levels (
  level_number INTEGER PRIMARY KEY CHECK (level_number >= 1),
  name TEXT NOT NULL,
  badge_label TEXT NOT NULL,
  required_lova_amount REAL NOT NULL DEFAULT 0 CHECK (required_lova_amount >= 0),
  mining_multiplier REAL NOT NULL DEFAULT 1.0 CHECK (mining_multiplier >= 1.0),
  daily_bonus_multiplier REAL NOT NULL DEFAULT 1.0 CHECK (daily_bonus_multiplier >= 1.0),
  benefits TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 18. LEVEL UPGRADE REQUESTS (External LOVA Payment TXID Verification — never uses in-app balance)
CREATE TABLE IF NOT EXISTS level_upgrade_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_level INTEGER NOT NULL CHECK (from_level >= 1),
  target_level INTEGER NOT NULL CHECK (target_level > from_level),
  required_lova_amount REAL NOT NULL CHECK (required_lova_amount > 0),
  admin_wallet_address TEXT NOT NULL,
  sender_wallet_address TEXT,
  tx_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  admin_note TEXT,
  reviewed_by_admin_id TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_level_upgrades_user ON level_upgrade_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_level_upgrades_status ON level_upgrade_requests(status, created_at DESC);

-- ==============================================================================
-- IDEMPOTENT INITIAL SEED DATA
-- ==============================================================================

INSERT OR IGNORE INTO app_settings (id) VALUES (1);

INSERT OR IGNORE INTO membership_levels (
  level_number, name, badge_label, required_lova_amount, mining_multiplier, daily_bonus_multiplier, benefits, is_active
) VALUES
  (
    1,
    'Starter Miner',
    'LVL 1',
    0,
    1.00,
    1.00,
    '["Standard 1.0x LOVA mining speed","Base daily check-in streak rewards","Access to tasks, referrals & TON wallet KYC"]',
    1
  ),
  (
    2,
    'Bronze Rig',
    'LVL 2',
    500,
    1.25,
    1.10,
    '["+25% Mining Speed & Session Cap (1.25x)","+10% Daily Check-In Bonus","Bronze Miner verified badge"]',
    1
  ),
  (
    3,
    'Silver Cluster',
    'LVL 3',
    2000,
    1.60,
    1.25,
    '["+60% Mining Speed & Session Cap (1.60x)","+25% Daily Check-In Bonus","Priority withdrawal review queue"]',
    1
  ),
  (
    4,
    'Gold Validator',
    'LVL 4',
    5000,
    2.20,
    1.40,
    '["+120% Mining Speed & Session Cap (2.20x)","+40% Daily Check-In Bonus","VIP fast-track TON payouts"]',
    1
  ),
  (
    5,
    'Diamond Sovereign',
    'LVL 5',
    15000,
    3.00,
    1.75,
    '["+200% Mining Speed & Session Cap (3.00x)","+75% Daily Check-In Bonus","Top-tier Diamond Sovereign status & priority support"]',
    1
  );

INSERT OR IGNORE INTO announcements (id, title, body, category, is_active) VALUES
  (
    '00000000-0000-4000-8000-000000000101',
    'LOVA Live Token Mining on TON Network',
    'Mine LOVA directly in Worker Mode. Connect your TON wallet and complete 0.05 GRAM KYC verification to unlock live withdrawal requests.',
    'airdrop',
    1
  ),
  (
    '00000000-0000-4000-8000-000000000102',
    '0.05 GRAM KYC Wallet Verification Required',
    'Before submitting any LOVA withdrawal request, workers must verify wallet ownership with an on-chain 0.05 GRAM Jetton transfer to the Admin TON wallet.',
    'security',
    1
  );

INSERT OR IGNORE INTO tasks (id, title, description, category, reward_amount, action_url, telegram_chat_id, required_count, verification_code, is_active, sort_order) VALUES
  (
    '00000000-0000-4000-8000-000000000201',
    'Complete 0.05 GRAM Wallet KYC Verification',
    'Connect your TON wallet and complete the on-chain 0.05 GRAM Jetton transfer verification.',
    'wallet_verified',
    250,
    NULL,
    NULL,
    1,
    NULL,
    1,
    1
  ),
  (
    '00000000-0000-4000-8000-000000000202',
    'Invite 3 Friends to LOVA Mining',
    'Share your unique referral link and onboard 3 active miners.',
    'referral_milestone',
    300,
    NULL,
    NULL,
    3,
    NULL,
    1,
    2
  ),
  (
    '00000000-0000-4000-8000-000000000203',
    'Complete 5 Mining Sessions',
    'Finish and claim rewards from 5 server-verified mining sessions.',
    'mining_sessions',
    150,
    NULL,
    NULL,
    5,
    NULL,
    1,
    3
  ),
  (
    '00000000-0000-4000-8000-000000000204',
    'Join Official LOVA Telegram Channel',
    'Join our official Telegram channel for live TON Jetton updates.',
    'telegram_channel',
    100,
    'https://t.me/LovaMiningOfficial',
    '@LovaMiningOfficial',
    1,
    NULL,
    1,
    4
  );
