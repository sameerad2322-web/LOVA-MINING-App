import crypto from 'node:crypto';
import type { D1Database } from './d1Types.ts';
import type {
  AdminRole,
  AnnouncementItem,
  AppSettings,
  LevelUpgradeRequest,
  LovaUser,
  MembershipLevel,
  MiningReward,
  MiningSession,
  TaskItem,
  TransactionItem,
  UserStatus,
  UserWallet,
  WalletVerification,
  WithdrawalItem,
} from '../src/types/lova.ts';

export interface ReferralRow {
  id: string;
  referrer_user_id: string;
  referred_user_id: string;
  level: 1 | 2;
  created_at: string;
}

export interface ReferralRewardRow {
  id: string;
  referrer_user_id: string;
  referred_user_id: string;
  level: 1 | 2;
  reward_source: 'signup_fixed' | 'mining_commission';
  amount: number;
  source_session_id: string | null;
  created_at: string;
}

export interface DailyCheckinRow {
  id: string;
  user_id: string;
  checkin_date: string;
  streak_day: number;
  reward_amount: number;
  created_at: string;
}

export interface TaskCompletionRow {
  id: string;
  user_id: string;
  task_id: string;
  started_at: string;
  completed_at: string | null;
  reward_amount: number;
  status: 'started' | 'completed';
  verification_meta: Record<string, unknown>;
}

export interface AdminRecord {
  id: string;
  telegram_id: number | null;
  email: string | null;
  display_name: string;
  role: AdminRole;
  is_active: boolean;
  created_at: string;
}

export interface AdminAuditLogRow {
  id: string;
  admin_id: string;
  admin_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

export const DEFAULT_MEMBERSHIP_LEVELS: MembershipLevel[] = [
  {
    level_number: 1,
    name: 'Starter Miner',
    badge_label: 'LVL 1',
    required_lova_amount: 0,
    mining_multiplier: 1.0,
    daily_bonus_multiplier: 1.0,
    benefits: [
      'Standard 1.0x LOVA mining speed',
      'Base daily check-in streak rewards',
      'Access to tasks, referrals & TON wallet KYC',
    ],
    is_active: true,
  },
  {
    level_number: 2,
    name: 'Bronze Rig',
    badge_label: 'LVL 2',
    required_lova_amount: 500,
    mining_multiplier: 1.25,
    daily_bonus_multiplier: 1.1,
    benefits: [
      '+25% Mining Speed & Session Cap (1.25x)',
      '+10% Daily Check-In Bonus',
      'Bronze Miner verified badge',
    ],
    is_active: true,
  },
  {
    level_number: 3,
    name: 'Silver Cluster',
    badge_label: 'LVL 3',
    required_lova_amount: 2000,
    mining_multiplier: 1.6,
    daily_bonus_multiplier: 1.25,
    benefits: [
      '+60% Mining Speed & Session Cap (1.60x)',
      '+25% Daily Check-In Bonus',
      'Priority withdrawal review queue',
    ],
    is_active: true,
  },
  {
    level_number: 4,
    name: 'Gold Validator',
    badge_label: 'LVL 4',
    required_lova_amount: 5000,
    mining_multiplier: 2.2,
    daily_bonus_multiplier: 1.4,
    benefits: [
      '+120% Mining Speed & Session Cap (2.20x)',
      '+40% Daily Check-In Bonus',
      'VIP fast-track TON payouts',
    ],
    is_active: true,
  },
  {
    level_number: 5,
    name: 'Diamond Sovereign',
    badge_label: 'LVL 5',
    required_lova_amount: 15000,
    mining_multiplier: 3.0,
    daily_bonus_multiplier: 1.75,
    benefits: [
      '+200% Mining Speed & Session Cap (3.00x)',
      '+75% Daily Check-In Bonus',
      'Top-tier Diamond Sovereign status & priority support',
    ],
    is_active: true,
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  app_name: 'LOVA Mining',
  mining_enabled: true,
  emergency_pause: false,
  maintenance_mode: false,
  reward_rate_per_hour: 12,
  mining_duration_seconds: 28800,
  min_claim_amount: 0.1,
  max_reward_per_session: 150,
  daily_bonus_amount: 25,
  referral_l1_fixed_bonus: 50,
  referral_l1_percent: 10,
  referral_l2_percent: 3,
  min_withdrawal: 500,
  max_withdrawal: 50000,
  gram_verification_fee: 0.05,
  admin_ton_wallet_override: null,
  admin_lova_wallet_address: null,
  lova_jetton_master_address: null,
  lova_jetton_decimals: 9,
  gram_jetton_master_address: null,
  gram_jetton_decimals: 9,
  updated_at: new Date().toISOString(),
};

function toBool(v: unknown, fallback = false): boolean {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
  return Boolean(v);
}

function toSqlBool(v: boolean): number {
  return v ? 1 : 0;
}

function parseJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function generateReferralCode(telegramId: number): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${telegramId}:${crypto.randomBytes(4).toString('hex')}`)
    .digest('hex');
  return `LOVA${hash.slice(0, 8).toUpperCase()}`;
}

export function maskDisplayName(
  user: Pick<LovaUser, 'username' | 'first_name' | 'telegram_id'>
): string {
  if (user.username) {
    const u = user.username;
    if (u.length <= 4) return `@${u[0]}***`;
    return `@${u.slice(0, 3)}***${u.slice(-2)}`;
  }
  if (user.first_name) {
    return `${user.first_name.slice(0, 2)}***`;
  }
  const idStr = String(user.telegram_id);
  return `Miner #${idStr.slice(-4)}`;
}

function normalizeUserRow(row: Record<string, unknown>): LovaUser {
  return {
    id: String(row.id),
    telegram_id: Number(row.telegram_id),
    username: (row.username as string | null) ?? null,
    first_name: (row.first_name as string | null) ?? null,
    last_name: (row.last_name as string | null) ?? null,
    photo_url: (row.photo_url as string | null) ?? null,
    referral_code: String(row.referral_code),
    referred_by_user_id: (row.referred_by_user_id as string | null) ?? null,
    available_balance: Number(row.available_balance || 0),
    pending_balance: Number(row.pending_balance || 0),
    total_earned: Number(row.total_earned || 0),
    total_withdrawn: Number(row.total_withdrawn || 0),
    streak_days: Number(row.streak_days || 0),
    last_checkin_date: (row.last_checkin_date as string | null) ?? null,
    membership_level: Number(row.membership_level || 1),
    membership_updated_at: (row.membership_updated_at as string | null) ?? null,
    status: (row.status as UserStatus) || 'active',
    ban_reason: (row.ban_reason as string | null) ?? null,
    last_active_at: String(row.last_active_at || new Date().toISOString()),
    created_at: String(row.created_at || new Date().toISOString()),
  };
}

function normalizeSettingsRow(row: Record<string, unknown>): AppSettings {
  return {
    app_name: String(row.app_name || DEFAULT_SETTINGS.app_name),
    mining_enabled: toBool(row.mining_enabled, true),
    emergency_pause: toBool(row.emergency_pause, false),
    maintenance_mode: toBool(row.maintenance_mode, false),
    reward_rate_per_hour: Number(row.reward_rate_per_hour ?? DEFAULT_SETTINGS.reward_rate_per_hour),
    mining_duration_seconds: Number(
      row.mining_duration_seconds ?? DEFAULT_SETTINGS.mining_duration_seconds
    ),
    min_claim_amount: Number(row.min_claim_amount ?? DEFAULT_SETTINGS.min_claim_amount),
    max_reward_per_session: Number(
      row.max_reward_per_session ?? DEFAULT_SETTINGS.max_reward_per_session
    ),
    daily_bonus_amount: Number(row.daily_bonus_amount ?? DEFAULT_SETTINGS.daily_bonus_amount),
    referral_l1_fixed_bonus: Number(
      row.referral_l1_fixed_bonus ?? DEFAULT_SETTINGS.referral_l1_fixed_bonus
    ),
    referral_l1_percent: Number(row.referral_l1_percent ?? DEFAULT_SETTINGS.referral_l1_percent),
    referral_l2_percent: Number(row.referral_l2_percent ?? DEFAULT_SETTINGS.referral_l2_percent),
    min_withdrawal: Number(row.min_withdrawal ?? DEFAULT_SETTINGS.min_withdrawal),
    max_withdrawal: Number(row.max_withdrawal ?? DEFAULT_SETTINGS.max_withdrawal),
    gram_verification_fee: Number(
      row.gram_verification_fee ?? DEFAULT_SETTINGS.gram_verification_fee
    ),
    admin_ton_wallet_override: (row.admin_ton_wallet_override as string | null) ?? null,
    admin_lova_wallet_address: (row.admin_lova_wallet_address as string | null) ?? null,
    lova_jetton_master_address: (row.lova_jetton_master_address as string | null) ?? null,
    lova_jetton_decimals: Number(row.lova_jetton_decimals ?? 9),
    gram_jetton_master_address: (row.gram_jetton_master_address as string | null) ?? null,
    gram_jetton_decimals: Number(row.gram_jetton_decimals ?? 9),
    updated_at: String(row.updated_at || new Date().toISOString()),
  };
}

function normalizeWalletRow(row: Record<string, unknown>): UserWallet {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    wallet_address: String(row.wallet_address),
    raw_address: String(row.raw_address),
    wallet_provider: (row.wallet_provider as string | null) ?? null,
    is_active: toBool(row.is_active, false),
    is_verified: toBool(row.is_verified, false),
    is_suspended: toBool(row.is_suspended, false),
    verified_at: (row.verified_at as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeVerificationRow(row: Record<string, unknown>): WalletVerification {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    wallet_id: (row.wallet_id as string | null) ?? null,
    tx_hash: String(row.tx_hash),
    sender_address: String(row.sender_address),
    recipient_address: String(row.recipient_address),
    jetton_master_address: String(row.jetton_master_address),
    amount_raw: String(row.amount_raw),
    amount_display: Number(row.amount_display || 0),
    decimals: Number(row.decimals || 9),
    status: (row.status as WalletVerification['status']) || 'verified',
    verified_at: String(row.verified_at),
    created_at: String(row.created_at),
  };
}

function normalizeSessionRow(row: Record<string, unknown>): MiningSession {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    reward_rate_per_sec: Number(row.reward_rate_per_sec || 0),
    duration_seconds: Number(row.duration_seconds || 0),
    max_reward: Number(row.max_reward || 0),
    started_at: String(row.started_at),
    ends_at: String(row.ends_at),
    stopped_at: (row.stopped_at as string | null) ?? null,
    claimed_at: (row.claimed_at as string | null) ?? null,
    claimed_amount: Number(row.claimed_amount || 0),
    status: row.status as MiningSession['status'],
  };
}

function normalizeRewardRow(row: Record<string, unknown>): MiningReward {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    session_id: (row.session_id as string | null) ?? null,
    reward_type: row.reward_type as MiningReward['reward_type'],
    amount: Number(row.amount || 0),
    is_demo_balance: toBool(row.is_demo_balance, false),
    created_at: String(row.created_at),
  };
}

function normalizeWithdrawalRow(row: Record<string, unknown>): WithdrawalItem {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    destination_address: String(row.destination_address),
    amount: Number(row.amount || 0),
    is_demo_request: toBool(row.is_demo_request, false),
    status: row.status as WithdrawalItem['status'],
    payout_tx_hash: (row.payout_tx_hash as string | null) ?? null,
    admin_note: (row.admin_note as string | null) ?? null,
    reviewed_at: (row.reviewed_at as string | null) ?? null,
    paid_at: (row.paid_at as string | null) ?? null,
    created_at: String(row.created_at),
  };
}

function normalizeTransactionRow(row: Record<string, unknown>): TransactionItem {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    tx_type: row.tx_type as TransactionItem['tx_type'],
    amount: Number(row.amount || 0),
    currency: String(row.currency || 'LOVA'),
    chain_tx_hash: (row.chain_tx_hash as string | null) ?? null,
    description: String(row.description || ''),
    is_demo: toBool(row.is_demo, false),
    created_at: String(row.created_at),
  };
}

function normalizeAnnouncementRow(row: Record<string, unknown>): AnnouncementItem {
  return {
    id: String(row.id),
    title: String(row.title),
    body: String(row.body),
    category: row.category as AnnouncementItem['category'],
    is_active: toBool(row.is_active, true),
    created_at: String(row.created_at),
  };
}

function normalizeMembershipLevelRow(row: Record<string, unknown>): MembershipLevel {
  return {
    level_number: Number(row.level_number || 1),
    name: String(row.name || `Level ${row.level_number || 1}`),
    badge_label: String(row.badge_label || `LVL ${row.level_number || 1}`),
    required_lova_amount: Number(row.required_lova_amount || 0),
    mining_multiplier: Number(row.mining_multiplier || 1),
    daily_bonus_multiplier: Number(row.daily_bonus_multiplier || 1),
    benefits: parseJsonArray(row.benefits),
    is_active: toBool(row.is_active, true),
  };
}

function normalizeLevelUpgradeRow(row: Record<string, unknown>): LevelUpgradeRequest {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    from_level: Number(row.from_level || 1),
    target_level: Number(row.target_level || 2),
    required_lova_amount: Number(row.required_lova_amount || 0),
    admin_wallet_address: String(row.admin_wallet_address),
    sender_wallet_address: (row.sender_wallet_address as string | null) ?? null,
    tx_hash: String(row.tx_hash),
    status: (row.status as LevelUpgradeRequest['status']) || 'Pending',
    admin_note: (row.admin_note as string | null) ?? null,
    reviewed_by_admin_id: (row.reviewed_by_admin_id as string | null) ?? null,
    reviewed_at: (row.reviewed_at as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: (row.updated_at as string | undefined) ?? undefined,
  };
}

function normalizeAdminRow(row: Record<string, unknown>): AdminRecord {
  return {
    id: String(row.id),
    telegram_id: row.telegram_id !== null && row.telegram_id !== undefined ? Number(row.telegram_id) : null,
    email: (row.email as string | null) ?? null,
    display_name: String(row.display_name),
    role: (row.role as AdminRole) || 'moderator',
    is_active: toBool(row.is_active, true),
    created_at: String(row.created_at),
  };
}

function normalizeTaskCompletionRow(row: Record<string, unknown>): TaskCompletionRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    task_id: String(row.task_id),
    started_at: String(row.started_at),
    completed_at: (row.completed_at as string | null) ?? null,
    reward_amount: Number(row.reward_amount || 0),
    status: (row.status as TaskCompletionRow['status']) || 'started',
    verification_meta: parseJsonObj(row.verification_meta),
  };
}

function normalizeAuditLogRow(row: Record<string, unknown>): AdminAuditLogRow {
  return {
    id: String(row.id),
    admin_id: String(row.admin_id),
    admin_role: String(row.admin_role),
    action: String(row.action),
    target_type: String(row.target_type),
    target_id: (row.target_id as string | null) ?? null,
    details: parseJsonObj(row.details),
    ip_address: (row.ip_address as string | null) ?? null,
    created_at: String(row.created_at),
  };
}

const SETTINGS_UPDATABLE_COLUMNS = new Set([
  'app_name',
  'mining_enabled',
  'emergency_pause',
  'maintenance_mode',
  'reward_rate_per_hour',
  'mining_duration_seconds',
  'min_claim_amount',
  'max_reward_per_session',
  'daily_bonus_amount',
  'referral_l1_fixed_bonus',
  'referral_l1_percent',
  'referral_l2_percent',
  'min_withdrawal',
  'max_withdrawal',
  'gram_verification_fee',
  'admin_ton_wallet_override',
  'admin_lova_wallet_address',
  'lova_jetton_master_address',
  'lova_jetton_decimals',
  'gram_jetton_master_address',
  'gram_jetton_decimals',
]);

// ==============================================================================
// CLOUDFLARE D1 (SQLITE) REPOSITORY FACTORY
// Compatible with both Cloudflare Workers/Pages D1 bindings & Node SQLite D1 adapter
// ==============================================================================

export function createD1Repository(d1: D1Database) {
  const repo = {
    async checkSchemaReady(): Promise<boolean> {
      try {
        const row = await d1
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
          .first<{ name: string }>();
        return Boolean(row?.name);
      } catch {
        return false;
      }
    },

    async getSettings(): Promise<AppSettings> {
      try {
        const row = await d1
          .prepare('SELECT * FROM app_settings WHERE id = 1')
          .first<Record<string, unknown>>();
        if (!row) return { ...DEFAULT_SETTINGS };
        return normalizeSettingsRow(row);
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    },

    async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
      const now = new Date().toISOString();
      const setClauses: string[] = ['updated_at = ?'];
      const values: unknown[] = [now];

      for (const [key, rawVal] of Object.entries(patch)) {
        if (!SETTINGS_UPDATABLE_COLUMNS.has(key) || rawVal === undefined) continue;
        setClauses.push(`${key} = ?`);
        if (typeof rawVal === 'boolean') {
          values.push(toSqlBool(rawVal));
        } else {
          values.push(rawVal);
        }
      }

      values.push(1);
      await d1
        .prepare(`UPDATE app_settings SET ${setClauses.join(', ')} WHERE id = ?`)
        .bind(...values)
        .run();

      return this.getSettings();
    },

    async getUserById(userId: string): Promise<LovaUser | null> {
      const row = await d1
        .prepare('SELECT * FROM users WHERE id = ?')
        .bind(userId)
        .first<Record<string, unknown>>();
      return row ? normalizeUserRow(row) : null;
    },

    async getUserByTelegramId(telegramId: number): Promise<LovaUser | null> {
      const row = await d1
        .prepare('SELECT * FROM users WHERE telegram_id = ?')
        .bind(telegramId)
        .first<Record<string, unknown>>();
      return row ? normalizeUserRow(row) : null;
    },

    async getUserByReferralCode(code: string): Promise<LovaUser | null> {
      const clean = code.trim().replace(/^ref_/i, '');
      if (!clean) return null;
      const row = await d1
        .prepare('SELECT * FROM users WHERE UPPER(referral_code) = UPPER(?)')
        .bind(clean)
        .first<Record<string, unknown>>();
      return row ? normalizeUserRow(row) : null;
    },

    async upsertTelegramUser(input: {
      telegram_id: number;
      username?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      photo_url?: string | null;
      referralCodeParam?: string | null;
    }): Promise<{ user: LovaUser; isNew: boolean }> {
      const now = new Date().toISOString();
      const existing = await this.getUserByTelegramId(input.telegram_id);

      if (existing) {
        await d1
          .prepare(
            `UPDATE users
             SET username = ?, first_name = ?, last_name = ?, photo_url = ?, last_active_at = ?, updated_at = ?
             WHERE id = ?`
          )
          .bind(
            input.username ?? existing.username,
            input.first_name ?? existing.first_name,
            input.last_name ?? existing.last_name,
            input.photo_url ?? existing.photo_url,
            now,
            now,
            existing.id
          )
          .run();
        const refreshed = (await this.getUserById(existing.id))!;
        return { user: refreshed, isNew: false };
      }

      let referrer: LovaUser | null = null;
      if (input.referralCodeParam) {
        const candidate = await this.getUserByReferralCode(input.referralCodeParam);
        if (
          candidate &&
          candidate.telegram_id !== input.telegram_id &&
          candidate.status === 'active'
        ) {
          referrer = candidate;
        }
      }

      const userId = crypto.randomUUID();
      const referral_code = generateReferralCode(input.telegram_id);

      await d1
        .prepare(
          `INSERT INTO users (
             id, telegram_id, username, first_name, last_name, photo_url,
             referral_code, referred_by_user_id, last_active_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          userId,
          input.telegram_id,
          input.username || null,
          input.first_name || null,
          input.last_name || null,
          input.photo_url || null,
          referral_code,
          referrer ? referrer.id : null,
          now,
          now,
          now
        )
        .run();

      const newUser = (await this.getUserById(userId))!;

      if (referrer) {
        const settings = await this.getSettings();
        await this.recordReferralLink(referrer.id, newUser.id, 1);

        if (settings.referral_l1_fixed_bonus > 0) {
          await this.creditUserReward(
            referrer.id,
            settings.referral_l1_fixed_bonus,
            'referral_bonus',
            'Level 1 referral signup bonus for inviting a miner'
          );
          await this.insertReferralReward({
            referrer_user_id: referrer.id,
            referred_user_id: newUser.id,
            level: 1,
            reward_source: 'signup_fixed',
            amount: settings.referral_l1_fixed_bonus,
            source_session_id: null,
          });
        }

        if (referrer.referred_by_user_id && referrer.referred_by_user_id !== newUser.id) {
          const l2Referrer = await this.getUserById(referrer.referred_by_user_id);
          if (l2Referrer && l2Referrer.status === 'active') {
            await this.recordReferralLink(l2Referrer.id, newUser.id, 2);
          }
        }
      }

      return { user: newUser, isNew: true };
    },

    async recordReferralLink(
      referrerUserId: string,
      referredUserId: string,
      level: 1 | 2
    ): Promise<void> {
      if (referrerUserId === referredUserId) return;
      await d1
        .prepare(
          `INSERT OR IGNORE INTO referrals (id, referrer_user_id, referred_user_id, level, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(crypto.randomUUID(), referrerUserId, referredUserId, level, new Date().toISOString())
        .run();
    },

    async insertReferralReward(
      input: Omit<ReferralRewardRow, 'id' | 'created_at'>
    ): Promise<void> {
      await d1
        .prepare(
          `INSERT INTO referral_rewards (
             id, referrer_user_id, referred_user_id, level, reward_source, amount, source_session_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          input.referrer_user_id,
          input.referred_user_id,
          input.level,
          input.reward_source,
          Number(input.amount.toFixed(6)),
          input.source_session_id ?? null,
          new Date().toISOString()
        )
        .run();
    },

    async creditUserReward(
      userId: string,
      amount: number,
      txType: TransactionItem['tx_type'],
      description: string,
      chainTxHash: string | null = null
    ): Promise<LovaUser> {
      const cleanAmount = Number(amount.toFixed(6));
      if (cleanAmount <= 0) throw new Error('Credit amount must be positive');

      const now = new Date().toISOString();
      const txId = crypto.randomUUID();

      await d1.batch([
        d1
          .prepare(
            `UPDATE users
             SET available_balance = ROUND(available_balance + ?, 6),
                 total_earned = ROUND(total_earned + ?, 6),
                 updated_at = ?
             WHERE id = ?`
          )
          .bind(cleanAmount, cleanAmount, now, userId),
        d1
          .prepare(
            `INSERT INTO transactions (
               id, user_id, tx_type, amount, currency, chain_tx_hash, description, is_demo, created_at
             ) VALUES (?, ?, ?, ?, 'LOVA', ?, ?, 0, ?)`
          )
          .bind(txId, userId, txType, cleanAmount, chainTxHash, description, now),
      ]);

      const updated = await this.getUserById(userId);
      if (!updated) throw new Error('User not found');
      return updated;
    },

    async getActiveOrExpiredSession(userId: string): Promise<MiningSession | null> {
      const row = await d1
        .prepare(
          `SELECT * FROM mining_sessions
           WHERE user_id = ? AND status IN ('active', 'expired')
           ORDER BY started_at DESC
           LIMIT 1`
        )
        .bind(userId)
        .first<Record<string, unknown>>();

      if (!row) return null;
      const session = normalizeSessionRow(row);
      if (session.status === 'active' && Date.now() >= new Date(session.ends_at).getTime()) {
        await d1
          .prepare("UPDATE mining_sessions SET status = 'expired' WHERE id = ?")
          .bind(session.id)
          .run();
        session.status = 'expired';
      }
      return session;
    },

    async startMiningSession(
      userId: string,
      settings: AppSettings,
      miningMultiplier = 1
    ): Promise<MiningSession> {
      const mult = Math.max(1, Number(miningMultiplier || 1));
      const nowMs = Date.now();
      const ratePerSec = Number(((settings.reward_rate_per_hour * mult) / 3600).toFixed(8));
      const maxReward = Number((settings.max_reward_per_session * mult).toFixed(6));
      const startedAt = new Date(nowMs).toISOString();
      const endsAt = new Date(nowMs + settings.mining_duration_seconds * 1000).toISOString();
      const id = crypto.randomUUID();

      await d1
        .prepare(
          `INSERT INTO mining_sessions (
             id, user_id, reward_rate_per_sec, duration_seconds, max_reward,
             started_at, ends_at, status, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`
        )
        .bind(
          id,
          userId,
          ratePerSec,
          settings.mining_duration_seconds,
          maxReward,
          startedAt,
          endsAt,
          startedAt
        )
        .run();

      const created = await d1
        .prepare('SELECT * FROM mining_sessions WHERE id = ?')
        .bind(id)
        .first<Record<string, unknown>>();
      return normalizeSessionRow(created!);
    },

    async settleMiningSession(
      session: MiningSession,
      action: 'stop' | 'claim',
      settings: AppSettings
    ): Promise<{ session: MiningSession; claimedAmount: number }> {
      const nowMs = Date.now();
      const startMs = new Date(session.started_at).getTime();
      const endMs = new Date(session.ends_at).getTime();
      const effectiveEndMs = Math.min(nowMs, endMs);
      const elapsedSeconds = Math.max(0, (effectiveEndMs - startMs) / 1000);
      const rawEarned = elapsedSeconds * session.reward_rate_per_sec;
      const cappedEarned = Number(Math.min(rawEarned, session.max_reward).toFixed(6));

      if (action === 'claim' && cappedEarned < settings.min_claim_amount) {
        throw new Error(
          `Minimum claim is ${settings.min_claim_amount} LOVA. Currently accrued: ${cappedEarned.toFixed(4)} LOVA.`
        );
      }

      const nowIso = new Date(nowMs).toISOString();
      const nextStatus = cappedEarned > 0 ? 'claimed' : 'stopped';

      const updRes = await d1
        .prepare(
          `UPDATE mining_sessions
           SET status = ?, stopped_at = ?, claimed_at = ?, claimed_amount = ?
           WHERE id = ? AND status IN ('active', 'expired')`
        )
        .bind(
          nextStatus,
          action === 'stop' ? nowIso : session.stopped_at,
          cappedEarned > 0 ? nowIso : null,
          cappedEarned,
          session.id
        )
        .run();

      if (!updRes.meta?.changes) {
        throw new Error('Mining session already settled or unavailable.');
      }

      if (cappedEarned > 0) {
        await d1.batch([
          d1
            .prepare(
              `INSERT INTO mining_rewards (
                 id, user_id, session_id, reward_type, amount, is_demo_balance, created_at
               ) VALUES (?, ?, ?, 'session_claim', ?, 0, ?)`
            )
            .bind(crypto.randomUUID(), session.user_id, session.id, cappedEarned, nowIso),
          d1
            .prepare(
              `UPDATE users
               SET available_balance = ROUND(available_balance + ?, 6),
                   total_earned = ROUND(total_earned + ?, 6),
                   updated_at = ?
               WHERE id = ?`
            )
            .bind(cappedEarned, cappedEarned, nowIso, session.user_id),
          d1
            .prepare(
              `INSERT INTO transactions (
                 id, user_id, tx_type, amount, currency, chain_tx_hash, description, is_demo, created_at
               ) VALUES (?, ?, 'mining_claim', ?, 'LOVA', NULL, ?, 0, ?)`
            )
            .bind(
              crypto.randomUUID(),
              session.user_id,
              cappedEarned,
              `Mining session reward claimed (${Math.floor(elapsedSeconds)}s)`,
              nowIso
            ),
        ]);

        await this.distributeReferralMiningCommissions(
          session.user_id,
          cappedEarned,
          session.id,
          settings
        );
      }

      const settledRow = await d1
        .prepare('SELECT * FROM mining_sessions WHERE id = ?')
        .bind(session.id)
        .first<Record<string, unknown>>();

      return { session: normalizeSessionRow(settledRow!), claimedAmount: cappedEarned };
    },

    async distributeReferralMiningCommissions(
      minerUserId: string,
      minedAmount: number,
      sessionId: string,
      settings: AppSettings
    ): Promise<void> {
      const miner = await this.getUserById(minerUserId);
      if (!miner || !miner.referred_by_user_id) return;

      const l1Referrer = await this.getUserById(miner.referred_by_user_id);
      if (l1Referrer && l1Referrer.status === 'active' && settings.referral_l1_percent > 0) {
        const l1Bonus = Number(((minedAmount * settings.referral_l1_percent) / 100).toFixed(6));
        if (l1Bonus > 0) {
          await this.creditUserReward(
            l1Referrer.id,
            l1Bonus,
            'referral_bonus',
            `L1 referral commission (${settings.referral_l1_percent}%) from invited miner`
          );
          await this.insertReferralReward({
            referrer_user_id: l1Referrer.id,
            referred_user_id: minerUserId,
            level: 1,
            reward_source: 'mining_commission',
            amount: l1Bonus,
            source_session_id: sessionId,
          });
        }

        if (l1Referrer.referred_by_user_id && settings.referral_l2_percent > 0) {
          const l2Referrer = await this.getUserById(l1Referrer.referred_by_user_id);
          if (l2Referrer && l2Referrer.status === 'active' && l2Referrer.id !== minerUserId) {
            const l2Bonus = Number(((minedAmount * settings.referral_l2_percent) / 100).toFixed(6));
            if (l2Bonus > 0) {
              await this.creditUserReward(
                l2Referrer.id,
                l2Bonus,
                'referral_bonus',
                `L2 referral commission (${settings.referral_l2_percent}%)`
              );
              await this.insertReferralReward({
                referrer_user_id: l2Referrer.id,
                referred_user_id: minerUserId,
                level: 2,
                reward_source: 'mining_commission',
                amount: l2Bonus,
                source_session_id: sessionId,
              });
            }
          }
        }
      }
    },

    async getMiningHistory(
      userId: string
    ): Promise<{ sessions: MiningSession[]; rewards: MiningReward[] }> {
      const [sessRes, rewRes] = await Promise.all([
        d1
          .prepare(
            'SELECT * FROM mining_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 30'
          )
          .bind(userId)
          .all<Record<string, unknown>>(),
        d1
          .prepare(
            'SELECT * FROM mining_rewards WHERE user_id = ? ORDER BY created_at DESC LIMIT 30'
          )
          .bind(userId)
          .all<Record<string, unknown>>(),
      ]);

      return {
        sessions: (sessRes.results || []).map(normalizeSessionRow),
        rewards: (rewRes.results || []).map(normalizeRewardRow),
      };
    },

    async performDailyCheckin(
      user: LovaUser,
      settings: AppSettings,
      dailyBonusMultiplier = 1
    ): Promise<{
      user: LovaUser;
      streakDay: number;
      rewardAmount: number;
    }> {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (user.last_checkin_date === todayStr) {
        throw new Error('Daily check-in already claimed today (UTC).');
      }

      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const nextStreak = user.last_checkin_date === yesterday ? user.streak_days + 1 : 1;
      const streakMultiplier = 1 + Math.min(nextStreak - 1, 6) * 0.1;
      const levelMult = Math.max(1, Number(dailyBonusMultiplier || 1));
      const rewardAmount = Number(
        (settings.daily_bonus_amount * streakMultiplier * levelMult).toFixed(6)
      );
      const now = new Date().toISOString();

      try {
        await d1.batch([
          d1
            .prepare(
              `INSERT INTO daily_checkins (id, user_id, checkin_date, streak_day, reward_amount, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .bind(crypto.randomUUID(), user.id, todayStr, nextStreak, rewardAmount, now),
          d1
            .prepare(
              `UPDATE users
               SET streak_days = ?,
                   last_checkin_date = ?,
                   available_balance = ROUND(available_balance + ?, 6),
                   total_earned = ROUND(total_earned + ?, 6),
                   updated_at = ?
               WHERE id = ?`
            )
            .bind(nextStreak, todayStr, rewardAmount, rewardAmount, now, user.id),
          d1
            .prepare(
              `INSERT INTO mining_rewards (
                 id, user_id, session_id, reward_type, amount, is_demo_balance, created_at
               ) VALUES (?, ?, NULL, ?, ?, 0, ?)`
            )
            .bind(
              crypto.randomUUID(),
              user.id,
              nextStreak > 1 ? 'streak_bonus' : 'daily_bonus',
              rewardAmount,
              now
            ),
          d1
            .prepare(
              `INSERT INTO transactions (
                 id, user_id, tx_type, amount, currency, chain_tx_hash, description, is_demo, created_at
               ) VALUES (?, ?, 'daily_checkin', ?, 'LOVA', NULL, ?, 0, ?)`
            )
            .bind(
              crypto.randomUUID(),
              user.id,
              rewardAmount,
              `Daily check-in reward (Day ${nextStreak} streak)`,
              now
            ),
        ]);
      } catch {
        throw new Error('Daily check-in already recorded for today.');
      }

      const updatedUser = (await this.getUserById(user.id))!;
      return { user: updatedUser, streakDay: nextStreak, rewardAmount };
    },

    async getTasksForUser(userId: string, includeInactive = false): Promise<TaskItem[]> {
      const taskSql = includeInactive
        ? 'SELECT * FROM tasks ORDER BY sort_order ASC'
        : 'SELECT * FROM tasks WHERE is_active = 1 ORDER BY sort_order ASC';

      const [tasksRes, compsRes] = await Promise.all([
        d1.prepare(taskSql).all<Record<string, unknown>>(),
        d1
          .prepare('SELECT * FROM task_completions WHERE user_id = ?')
          .bind(userId)
          .all<Record<string, unknown>>(),
      ]);

      const compMap = new Map(
        (compsRes.results || []).map((c) => [String(c.task_id), normalizeTaskCompletionRow(c)])
      );

      return (tasksRes.results || []).map((t) => {
        const comp = compMap.get(String(t.id));
        const verCode = (t.verification_code as string | null) ?? null;
        return {
          id: String(t.id),
          title: String(t.title),
          description: String(t.description),
          category: t.category as TaskItem['category'],
          reward_amount: Number(t.reward_amount || 0),
          action_url: (t.action_url as string | null) ?? null,
          telegram_chat_id: (t.telegram_chat_id as string | null) ?? null,
          required_count: Number(t.required_count || 1),
          verification_code: includeInactive ? verCode : null,
          requires_code: Boolean(verCode),
          is_active: toBool(t.is_active, true),
          sort_order: Number(t.sort_order || 0),
          user_status: comp ? comp.status : 'not_started',
          started_at: comp?.started_at || null,
          completed_at: comp?.completed_at || null,
        };
      });
    },

    async startTask(userId: string, taskId: string): Promise<TaskCompletionRow> {
      const existing = await d1
        .prepare('SELECT * FROM task_completions WHERE user_id = ? AND task_id = ?')
        .bind(userId, taskId)
        .first<Record<string, unknown>>();
      if (existing) return normalizeTaskCompletionRow(existing);

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await d1
        .prepare(
          `INSERT INTO task_completions (
             id, user_id, task_id, started_at, completed_at, reward_amount, status, verification_meta
           ) VALUES (?, ?, ?, ?, NULL, 0, 'started', '{}')`
        )
        .bind(id, userId, taskId, now)
        .run();

      const created = await d1
        .prepare('SELECT * FROM task_completions WHERE id = ?')
        .bind(id)
        .first<Record<string, unknown>>();
      return normalizeTaskCompletionRow(created!);
    },

    async completeTask(
      userId: string,
      task: TaskItem,
      meta: Record<string, unknown> = {}
    ): Promise<LovaUser> {
      const existing = await d1
        .prepare('SELECT * FROM task_completions WHERE user_id = ? AND task_id = ?')
        .bind(userId, task.id)
        .first<Record<string, unknown>>();

      if (existing && existing.status === 'completed') {
        throw new Error('Task reward already claimed.');
      }

      const now = new Date().toISOString();
      const metaJson = JSON.stringify(meta);

      const upsertStmt = existing
        ? d1
            .prepare(
              `UPDATE task_completions
               SET completed_at = ?, reward_amount = ?, status = 'completed', verification_meta = ?
               WHERE user_id = ? AND task_id = ?`
            )
            .bind(now, task.reward_amount, metaJson, userId, task.id)
        : d1
            .prepare(
              `INSERT INTO task_completions (
                 id, user_id, task_id, started_at, completed_at, reward_amount, status, verification_meta
               ) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)`
            )
            .bind(crypto.randomUUID(), userId, task.id, now, now, task.reward_amount, metaJson);

      await d1.batch([
        upsertStmt,
        d1
          .prepare(
            `UPDATE users
             SET available_balance = ROUND(available_balance + ?, 6),
                 total_earned = ROUND(total_earned + ?, 6),
                 updated_at = ?
             WHERE id = ?`
          )
          .bind(task.reward_amount, task.reward_amount, now, userId),
        d1
          .prepare(
            `INSERT INTO transactions (
               id, user_id, tx_type, amount, currency, chain_tx_hash, description, is_demo, created_at
             ) VALUES (?, ?, 'task_reward', ?, 'LOVA', NULL, ?, 0, ?)`
          )
          .bind(crypto.randomUUID(), userId, task.reward_amount, `Task completed: ${task.title}`, now),
      ]);

      return (await this.getUserById(userId))!;
    },

    async getTaskById(taskId: string): Promise<TaskItem | null> {
      const t = await d1
        .prepare('SELECT * FROM tasks WHERE id = ?')
        .bind(taskId)
        .first<Record<string, unknown>>();
      if (!t) return null;
      return {
        id: String(t.id),
        title: String(t.title),
        description: String(t.description),
        category: t.category as TaskItem['category'],
        reward_amount: Number(t.reward_amount || 0),
        action_url: (t.action_url as string | null) ?? null,
        telegram_chat_id: (t.telegram_chat_id as string | null) ?? null,
        required_count: Number(t.required_count || 1),
        verification_code: (t.verification_code as string | null) ?? null,
        requires_code: Boolean(t.verification_code),
        is_active: toBool(t.is_active, true),
        sort_order: Number(t.sort_order || 0),
      };
    },

    async getUserStatsForVerification(userId: string): Promise<{
      referralCount: number;
      completedMiningSessions: number;
      hasVerifiedWallet: boolean;
    }> {
      const [refRow, sessRow, walletRow] = await Promise.all([
        d1
          .prepare('SELECT COUNT(*) AS cnt FROM referrals WHERE referrer_user_id = ? AND level = 1')
          .bind(userId)
          .first<{ cnt: number }>(),
        d1
          .prepare("SELECT COUNT(*) AS cnt FROM mining_sessions WHERE user_id = ? AND status = 'claimed'")
          .bind(userId)
          .first<{ cnt: number }>(),
        d1
          .prepare(
            'SELECT is_verified, is_suspended FROM user_wallets WHERE user_id = ? AND is_active = 1 LIMIT 1'
          )
          .bind(userId)
          .first<{ is_verified: number; is_suspended: number }>(),
      ]);

      return {
        referralCount: Number(refRow?.cnt || 0),
        completedMiningSessions: Number(sessRow?.cnt || 0),
        hasVerifiedWallet: Boolean(
          walletRow && toBool(walletRow.is_verified) && !toBool(walletRow.is_suspended)
        ),
      };
    },

    async getReferralDashboard(userId: string) {
      const [refsRes, rewardsRes] = await Promise.all([
        d1
          .prepare(
            `SELECT r.id, r.level, r.created_at,
                    u.telegram_id, u.username, u.first_name, u.total_earned
             FROM referrals r
             LEFT JOIN users u ON u.id = r.referred_user_id
             WHERE r.referrer_user_id = ?
             ORDER BY r.created_at DESC`
          )
          .bind(userId)
          .all<Record<string, unknown>>(),
        d1
          .prepare(
            `SELECT * FROM referral_rewards
             WHERE referrer_user_id = ?
             ORDER BY created_at DESC
             LIMIT 50`
          )
          .bind(userId)
          .all<Record<string, unknown>>(),
      ]);

      const invited = (refsRes.results || []).map((r) => ({
        id: String(r.id),
        level: Number(r.level) as 1 | 2,
        created_at: String(r.created_at),
        handle: r.telegram_id
          ? maskDisplayName({
              telegram_id: Number(r.telegram_id),
              username: (r.username as string | null) ?? null,
              first_name: (r.first_name as string | null) ?? null,
            })
          : 'Miner',
        total_earned: Number(r.total_earned || 0),
      }));

      const rewards = (rewardsRes.results || []).map((rw) => ({
        id: String(rw.id),
        referrer_user_id: String(rw.referrer_user_id),
        referred_user_id: String(rw.referred_user_id),
        level: Number(rw.level) as 1 | 2,
        reward_source: rw.reward_source as ReferralRewardRow['reward_source'],
        amount: Number(rw.amount || 0),
        source_session_id: (rw.source_session_id as string | null) ?? null,
        created_at: String(rw.created_at),
      }));

      const totalReferralEarned = Number(
        rewards.reduce((acc, r) => acc + r.amount, 0).toFixed(6)
      );

      return {
        level1Count: invited.filter((i) => i.level === 1).length,
        level2Count: invited.filter((i) => i.level === 2).length,
        totalReferralEarned,
        invited,
        rewards,
      };
    },

    async getLeaderboard(tab: 'miners' | 'referrals', period: 'all' | 'weekly' | 'monthly') {
      const cutoffMs =
        period === 'weekly'
          ? Date.now() - 7 * 86400000
          : period === 'monthly'
            ? Date.now() - 30 * 86400000
            : 0;
      const cutoffIso = cutoffMs ? new Date(cutoffMs).toISOString() : null;

      if (tab === 'miners') {
        if (!cutoffIso) {
          const res = await d1
            .prepare(
              `SELECT id, telegram_id, username, first_name, total_earned
               FROM users
               WHERE status = 'active'
               ORDER BY total_earned DESC
               LIMIT 25`
            )
            .all<Record<string, unknown>>();
          return (res.results || []).map((u, idx) => ({
            rank: idx + 1,
            userId: String(u.id),
            handle: maskDisplayName({
              telegram_id: Number(u.telegram_id),
              username: (u.username as string | null) ?? null,
              first_name: (u.first_name as string | null) ?? null,
            }),
            score: Number(Number(u.total_earned || 0).toFixed(2)),
            unit: 'LOVA',
          }));
        }

        const res = await d1
          .prepare(
            `SELECT u.id, u.telegram_id, u.username, u.first_name, SUM(r.amount) AS score
             FROM mining_rewards r
             INNER JOIN users u ON u.id = r.user_id
             WHERE u.status = 'active' AND r.created_at >= ?
             GROUP BY u.id
             ORDER BY score DESC
             LIMIT 25`
          )
          .bind(cutoffIso)
          .all<Record<string, unknown>>();
        return (res.results || []).map((u, idx) => ({
          rank: idx + 1,
          userId: String(u.id),
          handle: maskDisplayName({
            telegram_id: Number(u.telegram_id),
            username: (u.username as string | null) ?? null,
            first_name: (u.first_name as string | null) ?? null,
          }),
          score: Number(Number(u.score || 0).toFixed(2)),
          unit: 'LOVA',
        }));
      }

      const refSql = cutoffIso
        ? `SELECT u.id, u.telegram_id, u.username, u.first_name, COUNT(r.id) AS score
           FROM referrals r
           INNER JOIN users u ON u.id = r.referrer_user_id
           WHERE u.status = 'active' AND r.level = 1 AND r.created_at >= ?
           GROUP BY u.id
           ORDER BY score DESC
           LIMIT 25`
        : `SELECT u.id, u.telegram_id, u.username, u.first_name, COUNT(r.id) AS score
           FROM referrals r
           INNER JOIN users u ON u.id = r.referrer_user_id
           WHERE u.status = 'active' AND r.level = 1
           GROUP BY u.id
           ORDER BY score DESC
           LIMIT 25`;

      const refStmt = cutoffIso ? d1.prepare(refSql).bind(cutoffIso) : d1.prepare(refSql);
      const refRes = await refStmt.all<Record<string, unknown>>();
      return (refRes.results || []).map((u, idx) => ({
        rank: idx + 1,
        userId: String(u.id),
        handle: maskDisplayName({
          telegram_id: Number(u.telegram_id),
          username: (u.username as string | null) ?? null,
          first_name: (u.first_name as string | null) ?? null,
        }),
        score: Number(u.score || 0),
        unit: 'Invites',
      }));
    },

    // WALLET & GRAM VERIFICATION
    async getActiveWallet(userId: string): Promise<UserWallet | null> {
      const row = await d1
        .prepare('SELECT * FROM user_wallets WHERE user_id = ? AND is_active = 1 LIMIT 1')
        .bind(userId)
        .first<Record<string, unknown>>();
      return row ? normalizeWalletRow(row) : null;
    },

    async connectWallet(
      userId: string,
      walletAddress: string,
      rawAddress: string,
      provider: string | null
    ): Promise<UserWallet> {
      const now = new Date().toISOString();
      const existing = await d1
        .prepare('SELECT * FROM user_wallets WHERE user_id = ? AND raw_address = ?')
        .bind(userId, rawAddress)
        .first<Record<string, unknown>>();

      const deactivateStmt = d1
        .prepare('UPDATE user_wallets SET is_active = 0, updated_at = ? WHERE user_id = ?')
        .bind(now, userId);

      if (existing) {
        await d1.batch([
          deactivateStmt,
          d1
            .prepare(
              `UPDATE user_wallets
               SET wallet_address = ?, wallet_provider = ?, is_active = 1, updated_at = ?
               WHERE id = ?`
            )
            .bind(walletAddress, provider, now, String(existing.id)),
        ]);
        const updated = await d1
          .prepare('SELECT * FROM user_wallets WHERE id = ?')
          .bind(String(existing.id))
          .first<Record<string, unknown>>();
        return normalizeWalletRow(updated!);
      }

      const id = crypto.randomUUID();
      await d1.batch([
        deactivateStmt,
        d1
          .prepare(
            `INSERT INTO user_wallets (
               id, user_id, wallet_address, raw_address, wallet_provider,
               is_active, is_verified, is_suspended, verified_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 1, 0, 0, NULL, ?, ?)`
          )
          .bind(id, userId, walletAddress, rawAddress, provider, now, now),
      ]);

      const created = await d1
        .prepare('SELECT * FROM user_wallets WHERE id = ?')
        .bind(id)
        .first<Record<string, unknown>>();
      return normalizeWalletRow(created!);
    },

    async disconnectWallet(userId: string): Promise<void> {
      await d1
        .prepare('UPDATE user_wallets SET is_active = 0, updated_at = ? WHERE user_id = ?')
        .bind(new Date().toISOString(), userId)
        .run();
    },

    async hasTxHashBeenUsed(txHash: string): Promise<boolean> {
      const clean = txHash.trim();
      const row = await d1
        .prepare('SELECT id FROM wallet_verifications WHERE tx_hash = ? LIMIT 1')
        .bind(clean)
        .first<{ id: string }>();
      return Boolean(row);
    },

    async recordVerifiedWalletPayment(input: {
      userId: string;
      walletId: string;
      txHash: string;
      senderAddress: string;
      recipientAddress: string;
      jettonMasterAddress: string;
      amountRaw: string;
      amountDisplay: number;
      decimals: number;
    }): Promise<{ wallet: UserWallet; verification: WalletVerification }> {
      const now = new Date().toISOString();
      const verId = crypto.randomUUID();

      try {
        await d1.batch([
          d1
            .prepare(
              `INSERT INTO wallet_verifications (
                 id, user_id, wallet_id, tx_hash, sender_address, recipient_address,
                 jetton_master_address, amount_raw, amount_display, decimals, status, verified_at, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?)`
            )
            .bind(
              verId,
              input.userId,
              input.walletId,
              input.txHash,
              input.senderAddress,
              input.recipientAddress,
              input.jettonMasterAddress,
              input.amountRaw,
              input.amountDisplay,
              input.decimals,
              now,
              now
            ),
          d1
            .prepare(
              'UPDATE user_wallets SET is_verified = 1, verified_at = ?, updated_at = ? WHERE id = ?'
            )
            .bind(now, now, input.walletId),
          d1
            .prepare(
              `INSERT INTO transactions (
                 id, user_id, tx_type, amount, currency, chain_tx_hash, description, is_demo, created_at
               ) VALUES (?, ?, 'gram_verification', ?, 'GRAM', ?, ?, 0, ?)`
            )
            .bind(
              crypto.randomUUID(),
              input.userId,
              input.amountDisplay,
              input.txHash,
              `Verified TON wallet via ${input.amountDisplay} GRAM Jetton transfer`,
              now
            ),
        ]);
      } catch {
        throw new Error('Transaction hash already used or invalid.');
      }

      const [walletRow, verRow] = await Promise.all([
        d1
          .prepare('SELECT * FROM user_wallets WHERE id = ?')
          .bind(input.walletId)
          .first<Record<string, unknown>>(),
        d1
          .prepare('SELECT * FROM wallet_verifications WHERE id = ?')
          .bind(verId)
          .first<Record<string, unknown>>(),
      ]);

      return {
        wallet: normalizeWalletRow(walletRow!),
        verification: normalizeVerificationRow(verRow!),
      };
    },

    async getUserWalletVerifications(userId: string): Promise<WalletVerification[]> {
      const res = await d1
        .prepare(
          'SELECT * FROM wallet_verifications WHERE user_id = ? ORDER BY created_at DESC'
        )
        .bind(userId)
        .all<Record<string, unknown>>();
      return (res.results || []).map(normalizeVerificationRow);
    },

    // WITHDRAWALS (Enforces 0.05 GRAM KYC verification + atomic debit)
    async requestWithdrawal(
      user: LovaUser,
      destinationAddress: string,
      amount: number
    ): Promise<{ user: LovaUser; withdrawal: WithdrawalItem }> {
      const activeWallet = await this.getActiveWallet(user.id);
      if (!activeWallet || !activeWallet.is_verified || activeWallet.is_suspended) {
        throw new Error(
          'KYC verification required: Connect your TON wallet and verify the 0.05 GRAM transfer before requesting a withdrawal.'
        );
      }

      const cleanAmount = Number(amount.toFixed(6));
      if (cleanAmount <= 0 || cleanAmount > user.available_balance) {
        throw new Error('Insufficient available LOVA balance.');
      }

      const now = new Date().toISOString();
      const debitRes = await d1
        .prepare(
          `UPDATE users
           SET available_balance = ROUND(available_balance - ?, 6),
               pending_balance = ROUND(pending_balance + ?, 6),
               updated_at = ?
           WHERE id = ? AND ROUND(available_balance, 6) >= ?`
        )
        .bind(cleanAmount, cleanAmount, now, user.id, cleanAmount)
        .run();

      if (!debitRes.meta?.changes) {
        throw new Error('Insufficient balance for withdrawal.');
      }

      const withdrawalId = crypto.randomUUID();
      await d1.batch([
        d1
          .prepare(
            `INSERT INTO withdrawals (
               id, user_id, destination_address, amount, is_demo_request, status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, 0, 'Pending', ?, ?)`
          )
          .bind(withdrawalId, user.id, destinationAddress, cleanAmount, now, now),
        d1
          .prepare(
            `INSERT INTO transactions (
               id, user_id, tx_type, amount, currency, chain_tx_hash, description, is_demo, created_at
             ) VALUES (?, ?, 'withdrawal_request', ?, 'LOVA', NULL, ?, 0, ?)`
          )
          .bind(
            crypto.randomUUID(),
            user.id,
            cleanAmount,
            `Withdrawal requested to ${destinationAddress.slice(0, 8)}...${destinationAddress.slice(-6)}`,
            now
          ),
      ]);

      const [updatedUser, wRow] = await Promise.all([
        this.getUserById(user.id),
        d1
          .prepare('SELECT * FROM withdrawals WHERE id = ?')
          .bind(withdrawalId)
          .first<Record<string, unknown>>(),
      ]);

      return {
        user: updatedUser!,
        withdrawal: normalizeWithdrawalRow(wRow!),
      };
    },

    async getUserWithdrawals(userId: string): Promise<WithdrawalItem[]> {
      const res = await d1
        .prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC')
        .bind(userId)
        .all<Record<string, unknown>>();
      return (res.results || []).map(normalizeWithdrawalRow);
    },

    async getUserTransactions(userId: string): Promise<TransactionItem[]> {
      const res = await d1
        .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
        .bind(userId)
        .all<Record<string, unknown>>();
      return (res.results || []).map(normalizeTransactionRow);
    },

    async getAnnouncements(includeInactive = false): Promise<AnnouncementItem[]> {
      const sql = includeInactive
        ? 'SELECT * FROM announcements ORDER BY created_at DESC'
        : 'SELECT * FROM announcements WHERE is_active = 1 ORDER BY created_at DESC';
      const res = await d1.prepare(sql).all<Record<string, unknown>>();
      return (res.results || []).map(normalizeAnnouncementRow);
    },

    // ==========================================================================
    // ADMIN REPOSITORY METHODS
    // ==========================================================================
    async getAdminsCount(): Promise<number> {
      const row = await d1
        .prepare('SELECT COUNT(*) AS cnt FROM admins')
        .first<{ cnt: number }>();
      return Number(row?.cnt || 0);
    },

    async getAdminByTelegramId(telegramId: number): Promise<AdminRecord | null> {
      const row = await d1
        .prepare('SELECT * FROM admins WHERE telegram_id = ? AND is_active = 1 LIMIT 1')
        .bind(telegramId)
        .first<Record<string, unknown>>();
      return row ? normalizeAdminRow(row) : null;
    },

    async upsertAdmin(input: {
      telegram_id: number | null;
      email: string | null;
      display_name: string;
      role: AdminRole;
    }): Promise<AdminRecord> {
      const existing = input.telegram_id
        ? await d1
            .prepare('SELECT * FROM admins WHERE telegram_id = ? LIMIT 1')
            .bind(input.telegram_id)
            .first<Record<string, unknown>>()
        : input.email
          ? await d1
              .prepare('SELECT * FROM admins WHERE email = ? LIMIT 1')
              .bind(input.email)
              .first<Record<string, unknown>>()
          : null;

      if (existing) {
        await d1
          .prepare('UPDATE admins SET display_name = ?, role = ?, is_active = 1 WHERE id = ?')
          .bind(input.display_name, input.role, String(existing.id))
          .run();
        const updated = await d1
          .prepare('SELECT * FROM admins WHERE id = ?')
          .bind(String(existing.id))
          .first<Record<string, unknown>>();
        return normalizeAdminRow(updated!);
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await d1
        .prepare(
          `INSERT INTO admins (id, telegram_id, email, display_name, role, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, 1, ?)`
        )
        .bind(id, input.telegram_id, input.email, input.display_name, input.role, now)
        .run();

      const created = await d1
        .prepare('SELECT * FROM admins WHERE id = ?')
        .bind(id)
        .first<Record<string, unknown>>();
      return normalizeAdminRow(created!);
    },

    async listAdmins(): Promise<AdminRecord[]> {
      const res = await d1
        .prepare('SELECT * FROM admins ORDER BY created_at DESC')
        .all<Record<string, unknown>>();
      return (res.results || []).map(normalizeAdminRow);
    },

    async toggleAdminActive(adminId: string, isActive: boolean): Promise<AdminRecord> {
      await d1
        .prepare('UPDATE admins SET is_active = ? WHERE id = ?')
        .bind(toSqlBool(isActive), adminId)
        .run();
      const row = await d1
        .prepare('SELECT * FROM admins WHERE id = ?')
        .bind(adminId)
        .first<Record<string, unknown>>();
      if (!row) throw new Error('Admin record not found');
      return normalizeAdminRow(row);
    },

    async writeAuditLog(entry: Omit<AdminAuditLogRow, 'id' | 'created_at'>): Promise<void> {
      try {
        await d1
          .prepare(
            `INSERT INTO admin_audit_logs (
               id, admin_id, admin_role, action, target_type, target_id, details, ip_address, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            crypto.randomUUID(),
            entry.admin_id,
            entry.admin_role,
            entry.action,
            entry.target_type,
            entry.target_id ?? null,
            JSON.stringify(entry.details || {}),
            entry.ip_address ?? null,
            new Date().toISOString()
          )
          .run();
      } catch {
        // non-fatal audit log error
      }
    },

    async getAdminOverview() {
      const dayAgo = new Date(Date.now() - 86400000).toISOString();
      const [
        totalUsersRow,
        activeUsersRow,
        rewardsSumRow,
        pendingWdRow,
        paidWdRow,
        referralsCountRow,
        verificationsRow,
        activeMinersRow,
        pendingLevelUpgradesRow,
      ] = await Promise.all([
        d1.prepare('SELECT COUNT(*) AS cnt FROM users').first<{ cnt: number }>(),
        d1
          .prepare('SELECT COUNT(*) AS cnt FROM users WHERE last_active_at >= ?')
          .bind(dayAgo)
          .first<{ cnt: number }>(),
        d1
          .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM mining_rewards')
          .first<{ total: number }>(),
        d1
          .prepare("SELECT COUNT(*) AS cnt FROM withdrawals WHERE status = 'Pending'")
          .first<{ cnt: number }>(),
        d1
          .prepare("SELECT COUNT(*) AS cnt FROM withdrawals WHERE status = 'Paid'")
          .first<{ cnt: number }>(),
        d1.prepare('SELECT COUNT(*) AS cnt FROM referrals').first<{ cnt: number }>(),
        d1
          .prepare(
            "SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_display), 0) AS total FROM wallet_verifications WHERE status = 'verified'"
          )
          .first<{ cnt: number; total: number }>(),
        d1
          .prepare("SELECT COUNT(*) AS cnt FROM mining_sessions WHERE status = 'active'")
          .first<{ cnt: number }>(),
        d1
          .prepare("SELECT COUNT(*) AS cnt FROM level_upgrade_requests WHERE status = 'Pending'")
          .first<{ cnt: number }>(),
      ]);

      return {
        totalUsers: Number(totalUsersRow?.cnt || 0),
        activeUsers: Number(activeUsersRow?.cnt || 0),
        activeMiners: Number(activeMinersRow?.cnt || 0),
        totalMiningRewards: Number(Number(rewardsSumRow?.total || 0).toFixed(4)),
        pendingWithdrawals: Number(pendingWdRow?.cnt || 0),
        completedWithdrawals: Number(paidWdRow?.cnt || 0),
        totalReferrals: Number(referralsCountRow?.cnt || 0),
        verifiedWalletsCount: Number(verificationsRow?.cnt || 0),
        totalGramFeesReceived: Number(Number(verificationsRow?.total || 0).toFixed(4)),
        pendingLevelUpgrades: Number(pendingLevelUpgradesRow?.cnt || 0),
      };
    },

    async listAdminUsers(search?: string) {
      const q = (search || '').trim();
      let usersRes;
      if (q && /^\d+$/.test(q)) {
        usersRes = await d1
          .prepare('SELECT * FROM users WHERE telegram_id = ?')
          .bind(Number(q))
          .all<Record<string, unknown>>();
      } else if (q) {
        const pattern = `%${q.toLowerCase()}%`;
        usersRes = await d1
          .prepare(
            `SELECT * FROM users
             WHERE LOWER(COALESCE(username, '')) LIKE ? OR LOWER(COALESCE(first_name, '')) LIKE ?
             ORDER BY created_at DESC
             LIMIT 50`
          )
          .bind(pattern, pattern)
          .all<Record<string, unknown>>();
      } else {
        usersRes = await d1
          .prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 100')
          .all<Record<string, unknown>>();
      }

      const walletsRes = await d1
        .prepare('SELECT * FROM user_wallets WHERE is_active = 1')
        .all<Record<string, unknown>>();
      const walletMap = new Map(
        (walletsRes.results || []).map((w) => [String(w.user_id), normalizeWalletRow(w)])
      );

      return (usersRes.results || []).map((u) => {
        const norm = normalizeUserRow(u);
        return {
          ...norm,
          wallet: walletMap.get(norm.id) || null,
        };
      });
    },

    async setUserStatus(userId: string, status: UserStatus, reason?: string): Promise<LovaUser> {
      await d1
        .prepare('UPDATE users SET status = ?, ban_reason = ?, updated_at = ? WHERE id = ?')
        .bind(status, reason || null, new Date().toISOString(), userId)
        .run();
      const updated = await this.getUserById(userId);
      if (!updated) throw new Error('User not found');
      return updated;
    },

    async listAdminWithdrawals(): Promise<WithdrawalItem[]> {
      const res = await d1
        .prepare(
          `SELECT w.*, u.telegram_id, u.username, u.first_name
           FROM withdrawals w
           LEFT JOIN users u ON u.id = w.user_id
           ORDER BY w.created_at DESC
           LIMIT 100`
        )
        .all<Record<string, unknown>>();

      return (res.results || []).map((row) => ({
        ...normalizeWithdrawalRow(row),
        telegram_id: row.telegram_id ? Number(row.telegram_id) : undefined,
        user_handle: row.username
          ? `@${String(row.username)}`
          : row.first_name
            ? String(row.first_name)
            : String(row.telegram_id || ''),
      }));
    },

    async processWithdrawalAction(input: {
      withdrawalId: string;
      action: 'approve' | 'reject' | 'mark_paid';
      adminId: string;
      adminNote?: string;
      payoutTxHash?: string;
    }): Promise<WithdrawalItem> {
      const now = new Date().toISOString();
      const wRow = await d1
        .prepare('SELECT * FROM withdrawals WHERE id = ?')
        .bind(input.withdrawalId)
        .first<Record<string, unknown>>();
      if (!wRow) throw new Error('Withdrawal not found');

      const w = normalizeWithdrawalRow(wRow);
      const user = await this.getUserById(w.user_id);
      if (!user) throw new Error('User not found');

      if (input.action === 'approve') {
        if (w.status !== 'Pending') throw new Error('Only Pending withdrawals can be approved.');
        const res = await d1
          .prepare(
            `UPDATE withdrawals
             SET status = 'Approved', admin_note = ?, reviewed_by_admin_id = ?, reviewed_at = ?, updated_at = ?
             WHERE id = ? AND status = 'Pending'`
          )
          .bind(input.adminNote || null, input.adminId, now, now, w.id)
          .run();
        if (!res.meta?.changes) throw new Error('Withdrawal state changed concurrently.');
      } else if (input.action === 'reject') {
        if (w.status === 'Paid' || w.status === 'Rejected') {
          throw new Error('Cannot reject a withdrawal already Paid or Rejected.');
        }
        await d1.batch([
          d1
            .prepare(
              `UPDATE withdrawals
               SET status = 'Rejected', admin_note = ?, reviewed_by_admin_id = ?, reviewed_at = ?, updated_at = ?
               WHERE id = ? AND status IN ('Pending', 'Approved')`
            )
            .bind(input.adminNote || 'Rejected by admin', input.adminId, now, now, w.id),
          d1
            .prepare(
              `UPDATE users
               SET available_balance = ROUND(available_balance + ?, 6),
                   pending_balance = MAX(0, ROUND(pending_balance - ?, 6)),
                   updated_at = ?
               WHERE id = ?`
            )
            .bind(w.amount, w.amount, now, user.id),
          d1
            .prepare(
              `INSERT INTO transactions (
                 id, user_id, tx_type, amount, currency, chain_tx_hash, description, is_demo, created_at
               ) VALUES (?, ?, 'withdrawal_refund', ?, 'LOVA', NULL, ?, ?, ?)`
            )
            .bind(
              crypto.randomUUID(),
              user.id,
              w.amount,
              `Withdrawal rejected & refunded (${input.adminNote || 'Admin review'})`,
              toSqlBool(w.is_demo_request),
              now
            ),
        ]);
      } else {
        // mark_paid
        if (w.status !== 'Approved' && w.status !== 'Pending') {
          throw new Error('Withdrawal must be Pending or Approved before marking Paid.');
        }
        await d1.batch([
          d1
            .prepare(
              `UPDATE withdrawals
               SET status = 'Paid', payout_tx_hash = ?, admin_note = ?, reviewed_by_admin_id = ?,
                   reviewed_at = COALESCE(reviewed_at, ?), paid_at = ?, updated_at = ?
               WHERE id = ? AND status IN ('Pending', 'Approved')`
            )
            .bind(
              input.payoutTxHash || null,
              input.adminNote || null,
              input.adminId,
              now,
              now,
              now,
              w.id
            ),
          d1
            .prepare(
              `UPDATE users
               SET pending_balance = MAX(0, ROUND(pending_balance - ?, 6)),
                   total_withdrawn = ROUND(total_withdrawn + ?, 6),
                   updated_at = ?
               WHERE id = ?`
            )
            .bind(w.amount, w.amount, now, user.id),
          d1
            .prepare(
              `INSERT INTO transactions (
                 id, user_id, tx_type, amount, currency, chain_tx_hash, description, is_demo, created_at
               ) VALUES (?, ?, 'withdrawal_paid', ?, 'LOVA', ?, ?, 0, ?)`
            )
            .bind(
              crypto.randomUUID(),
              user.id,
              w.amount,
              input.payoutTxHash || null,
              `Withdrawal paid on TON (${input.payoutTxHash?.slice(0, 10)}...)`,
              now
            ),
        ]);
      }

      const refreshed = await d1
        .prepare('SELECT * FROM withdrawals WHERE id = ?')
        .bind(w.id)
        .first<Record<string, unknown>>();
      return normalizeWithdrawalRow(refreshed!);
    },

    async listAdminWalletsAndPayments() {
      const [walletsRes, verRes] = await Promise.all([
        d1
          .prepare(
            `SELECT w.*, u.telegram_id, u.username
             FROM user_wallets w
             LEFT JOIN users u ON u.id = w.user_id
             ORDER BY w.updated_at DESC
             LIMIT 100`
          )
          .all<Record<string, unknown>>(),
        d1
          .prepare('SELECT * FROM wallet_verifications ORDER BY created_at DESC LIMIT 100')
          .all<Record<string, unknown>>(),
      ]);

      return {
        wallets: (walletsRes.results || []).map((w) => ({
          ...normalizeWalletRow(w),
          telegram_id: w.telegram_id ? Number(w.telegram_id) : undefined,
          username: (w.username as string | null) ?? undefined,
        })),
        verifications: (verRes.results || []).map(normalizeVerificationRow),
      };
    },

    async toggleWalletSuspension(walletId: string, suspended: boolean): Promise<UserWallet> {
      const now = new Date().toISOString();
      await d1
        .prepare('UPDATE user_wallets SET is_suspended = ?, updated_at = ? WHERE id = ?')
        .bind(toSqlBool(suspended), now, walletId)
        .run();
      const row = await d1
        .prepare('SELECT * FROM user_wallets WHERE id = ?')
        .bind(walletId)
        .first<Record<string, unknown>>();
      if (!row) throw new Error('Wallet not found');
      return normalizeWalletRow(row);
    },

    async createOrUpdateTask(taskInput: Partial<TaskItem> & { id?: string }): Promise<TaskItem> {
      const now = new Date().toISOString();
      const cleanPayload = {
        title: String(taskInput.title || 'New Task').trim().slice(0, 120),
        description: String(taskInput.description || '').trim().slice(0, 500),
        category: taskInput.category || 'custom',
        reward_amount: Math.max(0.01, Number(taskInput.reward_amount || 50)),
        action_url: taskInput.action_url?.trim() || null,
        telegram_chat_id: taskInput.telegram_chat_id?.trim() || null,
        required_count: Math.max(1, Number(taskInput.required_count || 1)),
        verification_code: taskInput.verification_code?.trim() || null,
        is_active: taskInput.is_active ?? true,
        sort_order: Number(taskInput.sort_order ?? 10),
      };

      if (taskInput.id) {
        await d1
          .prepare(
            `UPDATE tasks
             SET title = ?, description = ?, category = ?, reward_amount = ?, action_url = ?,
                 telegram_chat_id = ?, required_count = ?, verification_code = ?, is_active = ?,
                 sort_order = ?, updated_at = ?
             WHERE id = ?`
          )
          .bind(
            cleanPayload.title,
            cleanPayload.description,
            cleanPayload.category,
            cleanPayload.reward_amount,
            cleanPayload.action_url,
            cleanPayload.telegram_chat_id,
            cleanPayload.required_count,
            cleanPayload.verification_code,
            toSqlBool(cleanPayload.is_active),
            cleanPayload.sort_order,
            now,
            taskInput.id
          )
          .run();
        const updated = await this.getTaskById(taskInput.id);
        if (!updated) throw new Error('Task not found');
        return updated;
      }

      const id = crypto.randomUUID();
      await d1
        .prepare(
          `INSERT INTO tasks (
             id, title, description, category, reward_amount, action_url, telegram_chat_id,
             required_count, verification_code, is_active, sort_order, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          cleanPayload.title,
          cleanPayload.description,
          cleanPayload.category,
          cleanPayload.reward_amount,
          cleanPayload.action_url,
          cleanPayload.telegram_chat_id,
          cleanPayload.required_count,
          cleanPayload.verification_code,
          toSqlBool(cleanPayload.is_active),
          cleanPayload.sort_order,
          now,
          now
        )
        .run();

      return (await this.getTaskById(id))!;
    },

    async deleteTask(taskId: string): Promise<void> {
      await d1.prepare('DELETE FROM tasks WHERE id = ?').bind(taskId).run();
    },

    async createAnnouncement(
      input: Omit<AnnouncementItem, 'id' | 'created_at'>
    ): Promise<AnnouncementItem> {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await d1
        .prepare(
          `INSERT INTO announcements (id, title, body, category, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(id, input.title, input.body, input.category, toSqlBool(input.is_active), now)
        .run();
      const row = await d1
        .prepare('SELECT * FROM announcements WHERE id = ?')
        .bind(id)
        .first<Record<string, unknown>>();
      return normalizeAnnouncementRow(row!);
    },

    async deleteAnnouncement(id: string): Promise<void> {
      await d1.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();
    },

    async listAdminReferrals() {
      const [refsRes, rewardsRes] = await Promise.all([
        d1
          .prepare(
            `SELECT r.*,
                    u1.username AS referrer_username, u1.telegram_id AS referrer_telegram_id,
                    u2.username AS referred_username, u2.telegram_id AS referred_telegram_id
             FROM referrals r
             LEFT JOIN users u1 ON u1.id = r.referrer_user_id
             LEFT JOIN users u2 ON u2.id = r.referred_user_id
             ORDER BY r.created_at DESC
             LIMIT 100`
          )
          .all<Record<string, unknown>>(),
        d1
          .prepare('SELECT * FROM referral_rewards ORDER BY created_at DESC LIMIT 100')
          .all<Record<string, unknown>>(),
      ]);

      return {
        referrals: (refsRes.results || []).map((r) => ({
          id: String(r.id),
          referrer_user_id: String(r.referrer_user_id),
          referred_user_id: String(r.referred_user_id),
          level: Number(r.level) as 1 | 2,
          created_at: String(r.created_at),
          referrer_handle: r.referrer_username || r.referrer_telegram_id,
          referred_handle: r.referred_username || r.referred_telegram_id,
        })),
        rewards: (rewardsRes.results || []).map((rw) => ({
          id: String(rw.id),
          referrer_user_id: String(rw.referrer_user_id),
          referred_user_id: String(rw.referred_user_id),
          level: Number(rw.level) as 1 | 2,
          reward_source: rw.reward_source as ReferralRewardRow['reward_source'],
          amount: Number(rw.amount || 0),
          source_session_id: (rw.source_session_id as string | null) ?? null,
          created_at: String(rw.created_at),
        })),
      };
    },

    async listAuditLogs(): Promise<AdminAuditLogRow[]> {
      const res = await d1
        .prepare('SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 100')
        .all<Record<string, unknown>>();
      return (res.results || []).map(normalizeAuditLogRow);
    },

    // ==========================================================================
    // MEMBERSHIP LEVELS & EXTERNAL LOVA LEVEL-UP PAYMENTS
    // (Strictly never deducts from user's in-app mining / reward / available balance)
    // ==========================================================================
    async getMembershipLevels(includeInactive = false): Promise<MembershipLevel[]> {
      try {
        const sql = includeInactive
          ? 'SELECT * FROM membership_levels ORDER BY level_number ASC'
          : 'SELECT * FROM membership_levels WHERE is_active = 1 ORDER BY level_number ASC';
        const res = await d1.prepare(sql).all<Record<string, unknown>>();
        if (!res.results || res.results.length === 0) {
          return DEFAULT_MEMBERSHIP_LEVELS.filter((l) => includeInactive || l.is_active);
        }
        return res.results.map(normalizeMembershipLevelRow);
      } catch {
        return DEFAULT_MEMBERSHIP_LEVELS.filter((l) => includeInactive || l.is_active);
      }
    },

    async getMembershipLevelByNumber(levelNumber: number): Promise<MembershipLevel> {
      const levels = await this.getMembershipLevels(true);
      return (
        levels.find((l) => l.level_number === levelNumber) ||
        levels[0] ||
        DEFAULT_MEMBERSHIP_LEVELS[0]
      );
    },

    async upsertMembershipLevel(input: {
      level_number: number;
      name?: string;
      badge_label?: string;
      required_lova_amount?: number;
      mining_multiplier?: number;
      daily_bonus_multiplier?: number;
      benefits?: string[];
      is_active?: boolean;
    }): Promise<MembershipLevel> {
      const levelNumber = Math.max(1, Math.floor(Number(input.level_number)));
      const existing = await this.getMembershipLevelByNumber(levelNumber);
      const now = new Date().toISOString();

      const updatedRow: MembershipLevel = {
        level_number: levelNumber,
        name: (input.name ?? existing.name).trim().slice(0, 60) || `Level ${levelNumber}`,
        badge_label:
          (input.badge_label ?? existing.badge_label).trim().slice(0, 20) || `LVL ${levelNumber}`,
        required_lova_amount:
          levelNumber === 1
            ? 0
            : Math.max(1, Number(input.required_lova_amount ?? existing.required_lova_amount)),
        mining_multiplier: Math.max(1, Number(input.mining_multiplier ?? existing.mining_multiplier)),
        daily_bonus_multiplier: Math.max(
          1,
          Number(input.daily_bonus_multiplier ?? existing.daily_bonus_multiplier)
        ),
        benefits: Array.isArray(input.benefits)
          ? input.benefits.map((b) => String(b).trim()).filter(Boolean).slice(0, 8)
          : existing.benefits,
        is_active: levelNumber === 1 ? true : (input.is_active ?? existing.is_active),
      };

      await d1
        .prepare(
          `INSERT INTO membership_levels (
             level_number, name, badge_label, required_lova_amount, mining_multiplier,
             daily_bonus_multiplier, benefits, is_active, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(level_number) DO UPDATE SET
             name = excluded.name,
             badge_label = excluded.badge_label,
             required_lova_amount = excluded.required_lova_amount,
             mining_multiplier = excluded.mining_multiplier,
             daily_bonus_multiplier = excluded.daily_bonus_multiplier,
             benefits = excluded.benefits,
             is_active = excluded.is_active,
             updated_at = excluded.updated_at`
        )
        .bind(
          updatedRow.level_number,
          updatedRow.name,
          updatedRow.badge_label,
          updatedRow.required_lova_amount,
          updatedRow.mining_multiplier,
          updatedRow.daily_bonus_multiplier,
          JSON.stringify(updatedRow.benefits),
          toSqlBool(updatedRow.is_active),
          now,
          now
        )
        .run();

      const row = await d1
        .prepare('SELECT * FROM membership_levels WHERE level_number = ?')
        .bind(levelNumber)
        .first<Record<string, unknown>>();
      return normalizeMembershipLevelRow(row!);
    },

    async getUserLevelUpgradeRequests(userId: string): Promise<LevelUpgradeRequest[]> {
      const [levels, res] = await Promise.all([
        this.getMembershipLevels(true),
        d1
          .prepare(
            'SELECT * FROM level_upgrade_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
          )
          .bind(userId)
          .all<Record<string, unknown>>(),
      ]);
      const levelNameMap = new Map(levels.map((l) => [l.level_number, l.name]));
      return (res.results || []).map((row) => ({
        ...normalizeLevelUpgradeRow(row),
        target_level_name:
          levelNameMap.get(Number(row.target_level)) || `Level ${row.target_level}`,
      }));
    },

    async submitLevelUpgradeRequest(input: {
      user: LovaUser;
      targetLevel: number;
      txHash: string;
      senderWalletAddress?: string | null;
      adminWalletAddress: string;
    }): Promise<LevelUpgradeRequest> {
      const cleanTx = input.txHash.trim();
      if (cleanTx.length < 16) {
        throw new Error('Enter a valid TON payment transaction hash (TXID).');
      }

      const levels = await this.getMembershipLevels(false);
      const targetTier = levels.find((l) => l.level_number === input.targetLevel);
      if (!targetTier || targetTier.required_lova_amount <= 0) {
        throw new Error('Selected membership level is unavailable for upgrade.');
      }
      if (targetTier.level_number <= (input.user.membership_level || 1)) {
        throw new Error(
          `Your account is already at Level ${input.user.membership_level}. Choose a higher level to upgrade.`
        );
      }

      const [pendingRow, dupUpgradeRow, dupGramRow] = await Promise.all([
        d1
          .prepare(
            "SELECT id FROM level_upgrade_requests WHERE user_id = ? AND status = 'Pending' LIMIT 1"
          )
          .bind(input.user.id)
          .first<{ id: string }>(),
        d1
          .prepare('SELECT id FROM level_upgrade_requests WHERE LOWER(tx_hash) = LOWER(?) LIMIT 1')
          .bind(cleanTx)
          .first<{ id: string }>(),
        d1
          .prepare('SELECT id FROM wallet_verifications WHERE LOWER(tx_hash) = LOWER(?) LIMIT 1')
          .bind(cleanTx)
          .first<{ id: string }>(),
      ]);

      if (pendingRow) {
        throw new Error(
          'You already have a Pending level-up payment under review. Please wait for admin verification.'
        );
      }
      if (dupUpgradeRow || dupGramRow) {
        throw new Error('This transaction hash has already been submitted.');
      }

      const now = new Date().toISOString();
      const id = crypto.randomUUID();

      // IMPORTANT: Never deduct or touch users.available_balance, pending_balance, or total_earned.
      try {
        await d1
          .prepare(
            `INSERT INTO level_upgrade_requests (
               id, user_id, from_level, target_level, required_lova_amount,
               admin_wallet_address, sender_wallet_address, tx_hash, status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)`
          )
          .bind(
            id,
            input.user.id,
            input.user.membership_level || 1,
            targetTier.level_number,
            targetTier.required_lova_amount,
            input.adminWalletAddress,
            input.senderWalletAddress || null,
            cleanTx,
            now,
            now
          )
          .run();
      } catch {
        throw new Error('This transaction hash has already been submitted.');
      }

      const inserted = await d1
        .prepare('SELECT * FROM level_upgrade_requests WHERE id = ?')
        .bind(id)
        .first<Record<string, unknown>>();

      return {
        ...normalizeLevelUpgradeRow(inserted!),
        target_level_name: targetTier.name,
      };
    },

    async listAdminLevelUpgrades(): Promise<LevelUpgradeRequest[]> {
      const [levels, res] = await Promise.all([
        this.getMembershipLevels(true),
        d1
          .prepare(
            `SELECT r.*, u.telegram_id, u.username, u.first_name
             FROM level_upgrade_requests r
             LEFT JOIN users u ON u.id = r.user_id
             ORDER BY r.created_at DESC
             LIMIT 150`
          )
          .all<Record<string, unknown>>(),
      ]);
      const levelNameMap = new Map(levels.map((l) => [l.level_number, l.name]));

      return (res.results || []).map((r) => ({
        ...normalizeLevelUpgradeRow(r),
        target_level_name: levelNameMap.get(Number(r.target_level)) || `Level ${r.target_level}`,
        telegram_id: r.telegram_id ? Number(r.telegram_id) : undefined,
        user_handle: r.username
          ? `@${String(r.username)}`
          : r.first_name
            ? String(r.first_name)
            : String(r.telegram_id || ''),
      }));
    },

    async processLevelUpgradeAction(input: {
      requestId: string;
      action: 'approve' | 'reject';
      adminId: string;
      adminNote?: string | null;
    }): Promise<{ request: LevelUpgradeRequest; user: LovaUser }> {
      const now = new Date().toISOString();
      const reqRow = await d1
        .prepare('SELECT * FROM level_upgrade_requests WHERE id = ?')
        .bind(input.requestId)
        .first<Record<string, unknown>>();

      if (!reqRow) throw new Error('Level upgrade request not found.');
      if (reqRow.status !== 'Pending') {
        throw new Error(`Request already processed (${String(reqRow.status)}).`);
      }

      const userRow = await this.getUserById(String(reqRow.user_id));
      if (!userRow) throw new Error('User account not found.');

      const nextStatus = input.action === 'approve' ? 'Approved' : 'Rejected';
      const note =
        input.adminNote || (input.action === 'reject' ? 'Payment could not be verified' : null);

      const updReqStmt = d1
        .prepare(
          `UPDATE level_upgrade_requests
           SET status = ?, admin_note = ?, reviewed_by_admin_id = ?, reviewed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'Pending'`
        )
        .bind(nextStatus, note, input.adminId, now, now, String(reqRow.id));

      if (input.action === 'approve') {
        const nextLevel = Math.max(
          Number(userRow.membership_level || 1),
          Number(reqRow.target_level)
        );
        const batchRes = await d1.batch([
          updReqStmt,
          d1
            .prepare(
              `UPDATE users
               SET membership_level = MAX(membership_level, ?),
                   membership_updated_at = ?,
                   updated_at = ?
               WHERE id = ?`
            )
            .bind(nextLevel, now, now, userRow.id),
        ]);
        if (!batchRes[0]?.meta?.changes) {
          throw new Error('Request could not be updated or was already reviewed.');
        }
      } else {
        const res = await updReqStmt.run();
        if (!res.meta?.changes) {
          throw new Error('Request could not be updated or was already reviewed.');
        }
      }

      const [updatedReq, updatedUser] = await Promise.all([
        d1
          .prepare('SELECT * FROM level_upgrade_requests WHERE id = ?')
          .bind(String(reqRow.id))
          .first<Record<string, unknown>>(),
        this.getUserById(userRow.id),
      ]);

      return {
        request: normalizeLevelUpgradeRow(updatedReq!),
        user: updatedUser!,
      };
    },
  };

  return repo;
}

export type LovaD1Repository = ReturnType<typeof createD1Repository>;

let activeRepo: LovaD1Repository | null = null;

export function configureDatabase(d1: D1Database): LovaD1Repository {
  activeRepo = createD1Repository(d1);
  return activeRepo;
}

export function getActiveRepository(): LovaD1Repository {
  if (!activeRepo) {
    throw new Error(
      'Database not initialized. Configure a Cloudflare D1 binding or local SQLite D1 adapter.'
    );
  }
  return activeRepo;
}

export const db: LovaD1Repository = new Proxy({} as LovaD1Repository, {
  get(_target, prop) {
    const repo = getActiveRepository();
    const val = (repo as unknown as Record<PropertyKey, unknown>)[prop];
    return typeof val === 'function' ? val.bind(repo) : val;
  },
});
