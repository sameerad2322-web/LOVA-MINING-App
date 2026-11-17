import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { hasSupabaseConfig, serverConfig, setSupabaseSchemaReady } from './config.ts';
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

interface LocalStoreData {
  users: LovaUser[];
  user_wallets: UserWallet[];
  wallet_verifications: WalletVerification[];
  mining_sessions: MiningSession[];
  mining_rewards: MiningReward[];
  referrals: ReferralRow[];
  referral_rewards: ReferralRewardRow[];
  daily_checkins: DailyCheckinRow[];
  tasks: TaskItem[];
  task_completions: TaskCompletionRow[];
  withdrawals: WithdrawalItem[];
  transactions: TransactionItem[];
  app_settings: AppSettings;
  admins: AdminRecord[];
  admin_audit_logs: AdminAuditLogRow[];
  announcements: AnnouncementItem[];
  membership_levels: MembershipLevel[];
  level_upgrade_requests: LevelUpgradeRequest[];
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
      'Standard 1.0x mining speed',
      'Base daily check-in streak rewards',
      'Standard withdrawal queue',
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
      'Bronze Miner profile badge',
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

const DEFAULT_SETTINGS: AppSettings = {
  app_name: 'LOVA Mining',
  mining_enabled: true,
  emergency_pause: false,
  maintenance_mode: false,
  reward_rate_per_hour: 12,
  mining_duration_seconds: 28800, // 8 hours
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

function createSeedStore(): LocalStoreData {
  const now = new Date().toISOString();
  return {
    users: [],
    user_wallets: [],
    wallet_verifications: [],
    mining_sessions: [],
    mining_rewards: [],
    referrals: [],
    referral_rewards: [],
    daily_checkins: [],
    tasks: [
      {
        id: crypto.randomUUID(),
        title: 'Verify TON Wallet with 0.05 GRAM',
        description:
          'Connect your TON wallet and complete the on-chain 0.05 GRAM Jetton transfer verification.',
        category: 'wallet_verified',
        reward_amount: 250,
        action_url: null,
        telegram_chat_id: null,
        required_count: 1,
        verification_code: null,
        is_active: true,
        sort_order: 1,
      },
      {
        id: crypto.randomUUID(),
        title: 'Invite 3 Friends to LOVA Mining',
        description: 'Share your unique referral link and onboard 3 active miners.',
        category: 'referral_milestone',
        reward_amount: 300,
        action_url: null,
        telegram_chat_id: null,
        required_count: 3,
        verification_code: null,
        is_active: true,
        sort_order: 2,
      },
      {
        id: crypto.randomUUID(),
        title: 'Complete 5 Mining Sessions',
        description: 'Finish and claim rewards from 5 server-verified mining sessions.',
        category: 'mining_sessions',
        reward_amount: 150,
        action_url: null,
        telegram_chat_id: null,
        required_count: 5,
        verification_code: null,
        is_active: true,
        sort_order: 3,
      },
      {
        id: crypto.randomUUID(),
        title: 'Join Official LOVA Telegram Channel',
        description:
          'Join our official Telegram channel for TON Jetton deployment updates (verified via Telegram Bot API).',
        category: 'telegram_channel',
        reward_amount: 100,
        action_url: 'https://t.me/LovaMiningOfficial',
        telegram_chat_id: '@LovaMiningOfficial',
        required_count: 1,
        verification_code: null,
        is_active: true,
        sort_order: 4,
      },
    ],
    task_completions: [],
    withdrawals: [],
    transactions: [],
    app_settings: { ...DEFAULT_SETTINGS, updated_at: now },
    admins: [],
    admin_audit_logs: [],
    announcements: [
      {
        id: crypto.randomUUID(),
        title: 'LOVA Live Token Mining on TON Network',
        body: 'Mine LOVA directly in Worker Mode. Connect your TON wallet and complete 0.05 GRAM KYC verification to unlock live withdrawal requests.',
        category: 'airdrop',
        is_active: true,
        created_at: now,
      },
      {
        id: crypto.randomUUID(),
        title: '0.05 GRAM Wallet KYC Verification Required',
        body: 'Wallet KYC verification requires an explicit 0.05 GRAM Jetton transfer (not 0.05 TON) plus TON network gas, verified server-side on-chain before requesting withdrawals.',
        category: 'security',
        is_active: true,
        created_at: now,
      },
    ],
    membership_levels: DEFAULT_MEMBERSHIP_LEVELS.map((lvl) => ({ ...lvl, benefits: [...lvl.benefits] })),
    level_upgrade_requests: [],
  };
}

class LocalStore {
  private filePath: string;
  private data: LocalStoreData;

  constructor() {
    const dir = path.resolve(process.cwd(), '.data');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.filePath = path.join(dir, 'lova-store.json');
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = JSON.parse(raw) as LocalStoreData;
        if (!Array.isArray(this.data.membership_levels) || this.data.membership_levels.length === 0) {
          this.data.membership_levels = DEFAULT_MEMBERSHIP_LEVELS.map((lvl) => ({
            ...lvl,
            benefits: [...lvl.benefits],
          }));
        }
        if (!Array.isArray(this.data.level_upgrade_requests)) {
          this.data.level_upgrade_requests = [];
        }
        for (const u of this.data.users || []) {
          if (!u.membership_level || u.membership_level < 1) {
            u.membership_level = 1;
          }
        }
      } catch {
        this.data = createSeedStore();
        this.persist();
      }
    } else {
      this.data = createSeedStore();
      this.persist();
    }
  }

  get state(): LocalStoreData {
    return this.data;
  }

  persist(): void {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }
}

let supabaseClient: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(serverConfig.supabaseUrl, serverConfig.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseClient;
}

let _localStore: LocalStore | null = null;
function getLocalStore(): LocalStore {
  if (!_localStore) {
    _localStore = new LocalStore();
  }
  return _localStore;
}

let cachedSchemaReady: boolean | null = null;
let lastProbeAt = 0;

async function useSupabase(): Promise<boolean> {
  if (!hasSupabaseConfig()) {
    setSupabaseSchemaReady(false);
    return false;
  }
  if (cachedSchemaReady === true) {
    return true;
  }
  const now = Date.now();
  if (cachedSchemaReady === false && now - lastProbeAt < 30_000) {
    return false;
  }
  lastProbeAt = now;
  try {
    const sb = getSupabase();
    const { error } = await sb.from('users').select('id').limit(1);
    if (!error) {
      cachedSchemaReady = true;
      setSupabaseSchemaReady(true);
      return true;
    }
    cachedSchemaReady = false;
    setSupabaseSchemaReady(false);
    return false;
  } catch {
    cachedSchemaReady = false;
    setSupabaseSchemaReady(false);
    return false;
  }
}

function generateReferralCode(telegramId: number): string {
  const hash = crypto.createHash('sha256').update(`${telegramId}:${crypto.randomBytes(4).toString('hex')}`).digest('hex');
  return `LOVA${hash.slice(0, 8).toUpperCase()}`;
}

export function maskDisplayName(user: Pick<LovaUser, 'username' | 'first_name' | 'telegram_id'>): string {
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

// ==============================================================================
// UNIFIED REPOSITORY METHODS (Supabase PostgreSQL OR Local Preview Store)
// ==============================================================================

export const db = {
  async getSettings(): Promise<AppSettings> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data, error } = await sb.from('app_settings').select('*').eq('id', 1).single();
      if (error || !data) return { ...DEFAULT_SETTINGS };
      return {
        ...DEFAULT_SETTINGS,
        ...data,
        reward_rate_per_hour: Number(data.reward_rate_per_hour),
        min_claim_amount: Number(data.min_claim_amount),
        max_reward_per_session: Number(data.max_reward_per_session),
        daily_bonus_amount: Number(data.daily_bonus_amount),
        referral_l1_fixed_bonus: Number(data.referral_l1_fixed_bonus),
        referral_l1_percent: Number(data.referral_l1_percent),
        referral_l2_percent: Number(data.referral_l2_percent),
        min_withdrawal: Number(data.min_withdrawal),
        max_withdrawal: Number(data.max_withdrawal),
        gram_verification_fee: Number(data.gram_verification_fee),
        lova_jetton_decimals: Number(data.lova_jetton_decimals ?? 9),
        gram_jetton_decimals: Number(data.gram_jetton_decimals ?? 9),
      };
    }
    return { ...DEFAULT_SETTINGS, ...getLocalStore().state.app_settings };
  },

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const now = new Date().toISOString();
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('app_settings')
        .update({ ...patch, updated_at: now })
        .eq('id', 1)
        .select('*')
        .single();
      if (error) {
        // Fallback if optional Jetton / LOVA wallet columns were not yet migrated in an older Supabase instance
        const safePatch = { ...patch };
        delete safePatch.admin_lova_wallet_address;
        delete safePatch.lova_jetton_master_address;
        delete safePatch.lova_jetton_decimals;
        delete safePatch.gram_jetton_master_address;
        delete safePatch.gram_jetton_decimals;
        const retry = await sb
          .from('app_settings')
          .update({ ...safePatch, updated_at: now })
          .eq('id', 1)
          .select('*')
          .single();
        if (retry.error) throw new Error(retry.error.message);
        return { ...DEFAULT_SETTINGS, ...retry.data } as AppSettings;
      }
      return { ...DEFAULT_SETTINGS, ...data } as AppSettings;
    }
    getLocalStore().state.app_settings = {
      ...DEFAULT_SETTINGS,
      ...getLocalStore().state.app_settings,
      ...patch,
      updated_at: now,
    };
    getLocalStore().persist();
    return { ...getLocalStore().state.app_settings };
  },

  async getUserById(userId: string): Promise<LovaUser | null> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data } = await sb.from('users').select('*').eq('id', userId).maybeSingle();
      if (!data) return null;
      return normalizeUserRow(data);
    }
    return getLocalStore().state.users.find((u) => u.id === userId) || null;
  },

  async getUserByTelegramId(telegramId: number): Promise<LovaUser | null> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data } = await sb.from('users').select('*').eq('telegram_id', telegramId).maybeSingle();
      if (!data) return null;
      return normalizeUserRow(data);
    }
    return getLocalStore().state.users.find((u) => u.telegram_id === telegramId) || null;
  },

  async getUserByReferralCode(code: string): Promise<LovaUser | null> {
    const clean = code.trim().replace(/^ref_/i, '');
    if (!clean) return null;
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data } = await sb.from('users').select('*').eq('referral_code', clean).maybeSingle();
      if (!data) return null;
      return normalizeUserRow(data);
    }
    return getLocalStore().state.users.find((u) => u.referral_code.toUpperCase() === clean.toUpperCase()) || null;
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
      if (await useSupabase()) {
        const sb = getSupabase();
        const { data, error } = await sb
          .from('users')
          .update({
            username: input.username ?? existing.username,
            first_name: input.first_name ?? existing.first_name,
            last_name: input.last_name ?? existing.last_name,
            photo_url: input.photo_url ?? existing.photo_url,
            last_active_at: now,
            updated_at: now,
          })
          .eq('id', existing.id)
          .select('*')
          .single();
        if (error) throw new Error(error.message);
        return { user: normalizeUserRow(data), isNew: false };
      }
      existing.username = input.username ?? existing.username;
      existing.first_name = input.first_name ?? existing.first_name;
      existing.last_name = input.last_name ?? existing.last_name;
      existing.photo_url = input.photo_url ?? existing.photo_url;
      existing.last_active_at = now;
      getLocalStore().persist();
      return { user: existing, isNew: false };
    }

    // Check referral attribution (anti-self-referral enforced)
    let referrer: LovaUser | null = null;
    if (input.referralCodeParam) {
      const candidate = await this.getUserByReferralCode(input.referralCodeParam);
      if (candidate && candidate.telegram_id !== input.telegram_id && candidate.status === 'active') {
        referrer = candidate;
      }
    }

    const referral_code = generateReferralCode(input.telegram_id);

    let newUser: LovaUser;
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('users')
        .insert({
          telegram_id: input.telegram_id,
          username: input.username || null,
          first_name: input.first_name || null,
          last_name: input.last_name || null,
          photo_url: input.photo_url || null,
          referral_code,
          referred_by_user_id: referrer ? referrer.id : null,
          last_active_at: now,
        })
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      newUser = normalizeUserRow(data);
    } else {
      newUser = {
        id: crypto.randomUUID(),
        telegram_id: input.telegram_id,
        username: input.username || null,
        first_name: input.first_name || null,
        last_name: input.last_name || null,
        photo_url: input.photo_url || null,
        referral_code,
        referred_by_user_id: referrer ? referrer.id : null,
        available_balance: 0,
        pending_balance: 0,
        total_earned: 0,
        total_withdrawn: 0,
        streak_days: 0,
        last_checkin_date: null,
        membership_level: 1,
        membership_updated_at: null,
        status: 'active',
        ban_reason: null,
        last_active_at: now,
        created_at: now,
      };
      getLocalStore().state.users.push(newUser);
      getLocalStore().persist();
    }

    // Track Level 1 & Level 2 referrals + fixed registration bonus
    if (referrer) {
      const settings = await this.getSettings();
      await this.recordReferralLink(referrer.id, newUser.id, 1);

      if (settings.referral_l1_fixed_bonus > 0) {
        await this.creditUserReward(
          referrer.id,
          settings.referral_l1_fixed_bonus,
          'referral_bonus',
          `Level 1 referral signup bonus for inviting a miner`
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

  async recordReferralLink(referrerUserId: string, referredUserId: string, level: 1 | 2): Promise<void> {
    if (referrerUserId === referredUserId) return;
    if (await useSupabase()) {
      const sb = getSupabase();
      await sb
        .from('referrals')
        .upsert(
          { referrer_user_id: referrerUserId, referred_user_id: referredUserId, level },
          { onConflict: 'referred_user_id,level', ignoreDuplicates: true }
        );
      return;
    }
    const exists = getLocalStore().state.referrals.some(
      (r) => r.referred_user_id === referredUserId && r.level === level
    );
    if (!exists) {
      getLocalStore().state.referrals.push({
        id: crypto.randomUUID(),
        referrer_user_id: referrerUserId,
        referred_user_id: referredUserId,
        level,
        created_at: new Date().toISOString(),
      });
      getLocalStore().persist();
    }
  },

  async insertReferralReward(input: Omit<ReferralRewardRow, 'id' | 'created_at'>): Promise<void> {
    if (await useSupabase()) {
      const sb = getSupabase();
      await sb.from('referral_rewards').insert(input);
      return;
    }
    getLocalStore().state.referral_rewards.push({
      ...input,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    });
    getLocalStore().persist();
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

    if (await useSupabase()) {
      const sb = getSupabase();
      const user = await this.getUserById(userId);
      if (!user) throw new Error('User not found');
      const nextAvailable = Number((user.available_balance + cleanAmount).toFixed(6));
      const nextTotal = Number((user.total_earned + cleanAmount).toFixed(6));

      const { data, error } = await sb
        .from('users')
        .update({
          available_balance: nextAvailable,
          total_earned: nextTotal,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select('*')
        .single();
      if (error) throw new Error(error.message);

      await sb.from('transactions').insert({
        user_id: userId,
        tx_type: txType,
        amount: cleanAmount,
        currency: 'LOVA',
        chain_tx_hash: chainTxHash,
        description,
        is_demo: false,
      });

      return normalizeUserRow(data);
    }

    const user = getLocalStore().state.users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found');
    user.available_balance = Number((user.available_balance + cleanAmount).toFixed(6));
    user.total_earned = Number((user.total_earned + cleanAmount).toFixed(6));
    getLocalStore().state.transactions.unshift({
      id: crypto.randomUUID(),
      user_id: userId,
      tx_type: txType,
      amount: cleanAmount,
      currency: 'LOVA',
      chain_tx_hash: chainTxHash,
      description,
      is_demo: false,
      created_at: new Date().toISOString(),
    });
    getLocalStore().persist();
    return user;
  },

  async getActiveOrExpiredSession(userId: string): Promise<MiningSession | null> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data } = await sb
        .from('mining_sessions')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['active', 'expired'])
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return null;
      const session = normalizeSessionRow(data);
      if (session.status === 'active' && Date.now() >= new Date(session.ends_at).getTime()) {
        await sb.from('mining_sessions').update({ status: 'expired' }).eq('id', session.id);
        session.status = 'expired';
      }
      return session;
    }

    const session = getLocalStore().state.mining_sessions
      .filter((s) => s.user_id === userId && (s.status === 'active' || s.status === 'expired'))
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];

    if (!session) return null;
    if (session.status === 'active' && Date.now() >= new Date(session.ends_at).getTime()) {
      session.status = 'expired';
      getLocalStore().persist();
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
    const endsAt = new Date(nowMs + settings.mining_duration_seconds * 1000).toISOString();
    const startedAt = new Date(nowMs).toISOString();

    if (await useSupabase()) {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('mining_sessions')
        .insert({
          user_id: userId,
          reward_rate_per_sec: ratePerSec,
          duration_seconds: settings.mining_duration_seconds,
          max_reward: maxReward,
          started_at: startedAt,
          ends_at: endsAt,
          status: 'active',
        })
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return normalizeSessionRow(data);
    }

    const session: MiningSession = {
      id: crypto.randomUUID(),
      user_id: userId,
      reward_rate_per_sec: ratePerSec,
      duration_seconds: settings.mining_duration_seconds,
      max_reward: maxReward,
      started_at: startedAt,
      ends_at: endsAt,
      stopped_at: null,
      claimed_at: null,
      claimed_amount: 0,
      status: 'active',
    };
    getLocalStore().state.mining_sessions.unshift(session);
    getLocalStore().persist();
    return session;
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

    const nowIso = new Date(nowMs).toISOString();

    if (action === 'claim' && cappedEarned < settings.min_claim_amount) {
      throw new Error(`Minimum claim is ${settings.min_claim_amount} LOVA. Currently accrued: ${cappedEarned.toFixed(4)} LOVA.`);
    }

    const nextStatus = cappedEarned > 0 ? 'claimed' : 'stopped';

    if (await useSupabase()) {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('mining_sessions')
        .update({
          status: nextStatus,
          stopped_at: action === 'stop' ? nowIso : session.stopped_at,
          claimed_at: cappedEarned > 0 ? nowIso : null,
          claimed_amount: cappedEarned,
        })
        .eq('id', session.id)
        .in('status', ['active', 'expired'])
        .select('*')
        .single();
      if (error || !data) throw new Error('Mining session already settled or unavailable.');

      if (cappedEarned > 0) {
        await sb.from('mining_rewards').insert({
          user_id: session.user_id,
          session_id: session.id,
          reward_type: 'session_claim',
          amount: cappedEarned,
          is_demo_balance: false,
        });
      }
      session = normalizeSessionRow(data);
    } else {
      const target = getLocalStore().state.mining_sessions.find((s) => s.id === session.id);
      if (!target || (target.status !== 'active' && target.status !== 'expired')) {
        throw new Error('Mining session already settled or unavailable.');
      }
      target.status = nextStatus;
      if (action === 'stop') target.stopped_at = nowIso;
      if (cappedEarned > 0) {
        target.claimed_at = nowIso;
        target.claimed_amount = cappedEarned;
        getLocalStore().state.mining_rewards.unshift({
          id: crypto.randomUUID(),
          user_id: session.user_id,
          session_id: session.id,
          reward_type: 'session_claim',
          amount: cappedEarned,
          is_demo_balance: false,
          created_at: nowIso,
        });
      }
      getLocalStore().persist();
      session = target;
    }

    if (cappedEarned > 0) {
      await this.creditUserReward(
        session.user_id,
        cappedEarned,
        'mining_claim',
        `Mining session reward claimed (${Math.floor(elapsedSeconds)}s)`
      );
      await this.distributeReferralMiningCommissions(session.user_id, cappedEarned, session.id, settings);
    }

    return { session, claimedAmount: cappedEarned };
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

  async getMiningHistory(userId: string): Promise<{ sessions: MiningSession[]; rewards: MiningReward[] }> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const [{ data: sessions }, { data: rewards }] = await Promise.all([
        sb
          .from('mining_sessions')
          .select('*')
          .eq('user_id', userId)
          .order('started_at', { ascending: false })
          .limit(30),
        sb
          .from('mining_rewards')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(30),
      ]);
      return {
        sessions: (sessions || []).map(normalizeSessionRow),
        rewards: (rewards || []).map((r) => ({ ...r, amount: Number(r.amount) })),
      };
    }
    return {
      sessions: getLocalStore().state.mining_sessions.filter((s) => s.user_id === userId).slice(0, 30),
      rewards: getLocalStore().state.mining_rewards.filter((r) => r.user_id === userId).slice(0, 30),
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
    // Consecutive streak multiplier: up to +50% on Day 7+ plus membership level daily bonus multiplier
    const streakMultiplier = 1 + Math.min(nextStreak - 1, 6) * 0.1;
    const levelMult = Math.max(1, Number(dailyBonusMultiplier || 1));
    const rewardAmount = Number((settings.daily_bonus_amount * streakMultiplier * levelMult).toFixed(6));

    if (await useSupabase()) {
      const sb = getSupabase();
      const { error: ciErr } = await sb.from('daily_checkins').insert({
        user_id: user.id,
        checkin_date: todayStr,
        streak_day: nextStreak,
        reward_amount: rewardAmount,
      });
      if (ciErr) throw new Error('Daily check-in already recorded for today.');

      await sb
        .from('users')
        .update({ streak_days: nextStreak, last_checkin_date: todayStr })
        .eq('id', user.id);

      await sb.from('mining_rewards').insert({
        user_id: user.id,
        session_id: null,
        reward_type: nextStreak > 1 ? 'streak_bonus' : 'daily_bonus',
        amount: rewardAmount,
        is_demo_balance: false,
      });
    } else {
      const target = getLocalStore().state.users.find((u) => u.id === user.id)!;
      target.streak_days = nextStreak;
      target.last_checkin_date = todayStr;
      getLocalStore().state.daily_checkins.unshift({
        id: crypto.randomUUID(),
        user_id: user.id,
        checkin_date: todayStr,
        streak_day: nextStreak,
        reward_amount: rewardAmount,
        created_at: new Date().toISOString(),
      });
      getLocalStore().state.mining_rewards.unshift({
        id: crypto.randomUUID(),
        user_id: user.id,
        session_id: null,
        reward_type: nextStreak > 1 ? 'streak_bonus' : 'daily_bonus',
        amount: rewardAmount,
        is_demo_balance: false,
        created_at: new Date().toISOString(),
      });
      getLocalStore().persist();
    }

    const updatedUser = await this.creditUserReward(
      user.id,
      rewardAmount,
      'daily_checkin',
      `Daily check-in reward (Day ${nextStreak} streak)`
    );

    return { user: updatedUser, streakDay: nextStreak, rewardAmount };
  },

  async getTasksForUser(userId: string, includeInactive = false): Promise<TaskItem[]> {
    if (await useSupabase()) {
      const sb = getSupabase();
      let q = sb.from('tasks').select('*').order('sort_order', { ascending: true });
      if (!includeInactive) q = q.eq('is_active', true);
      const [{ data: tasks }, { data: completions }] = await Promise.all([
        q,
        sb.from('task_completions').select('*').eq('user_id', userId),
      ]);
      const map = new Map((completions || []).map((c) => [c.task_id, c]));
      return (tasks || []).map((t) => {
        const comp = map.get(t.id);
        return {
          ...t,
          reward_amount: Number(t.reward_amount),
          requires_code: Boolean(t.verification_code),
          verification_code: includeInactive ? t.verification_code : null,
          user_status: comp ? comp.status : 'not_started',
          started_at: comp?.started_at || null,
          completed_at: comp?.completed_at || null,
        } as TaskItem;
      });
    }

    const compMap = new Map(
      getLocalStore().state.task_completions.filter((c) => c.user_id === userId).map((c) => [c.task_id, c])
    );
    return getLocalStore().state.tasks
      .filter((t) => includeInactive || t.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((t) => {
        const comp = compMap.get(t.id);
        return {
          ...t,
          requires_code: Boolean(t.verification_code),
          verification_code: includeInactive ? t.verification_code : null,
          user_status: comp ? comp.status : 'not_started',
          started_at: comp?.started_at || null,
          completed_at: comp?.completed_at || null,
        };
      });
  },

  async startTask(userId: string, taskId: string): Promise<TaskCompletionRow> {
    const now = new Date().toISOString();
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data: existing } = await sb
        .from('task_completions')
        .select('*')
        .eq('user_id', userId)
        .eq('task_id', taskId)
        .maybeSingle();
      if (existing) return existing as TaskCompletionRow;
      const { data, error } = await sb
        .from('task_completions')
        .insert({ user_id: userId, task_id: taskId, status: 'started', started_at: now })
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as TaskCompletionRow;
    }

    const existing = getLocalStore().state.task_completions.find(
      (c) => c.user_id === userId && c.task_id === taskId
    );
    if (existing) return existing;
    const row: TaskCompletionRow = {
      id: crypto.randomUUID(),
      user_id: userId,
      task_id: taskId,
      started_at: now,
      completed_at: null,
      reward_amount: 0,
      status: 'started',
      verification_meta: {},
    };
    getLocalStore().state.task_completions.push(row);
    getLocalStore().persist();
    return row;
  },

  async completeTask(
    userId: string,
    task: TaskItem,
    meta: Record<string, unknown> = {}
  ): Promise<LovaUser> {
    const now = new Date().toISOString();
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data: existing } = await sb
        .from('task_completions')
        .select('*')
        .eq('user_id', userId)
        .eq('task_id', task.id)
        .maybeSingle();

      if (existing && existing.status === 'completed') {
        throw new Error('Task reward already claimed.');
      }

      const { error } = await sb.from('task_completions').upsert(
        {
          user_id: userId,
          task_id: task.id,
          started_at: existing?.started_at || now,
          completed_at: now,
          reward_amount: task.reward_amount,
          status: 'completed',
          verification_meta: meta,
        },
        { onConflict: 'user_id,task_id' }
      );
      if (error) throw new Error(error.message);
    } else {
      let row = getLocalStore().state.task_completions.find(
        (c) => c.user_id === userId && c.task_id === task.id
      );
      if (row && row.status === 'completed') {
        throw new Error('Task reward already claimed.');
      }
      if (!row) {
        row = {
          id: crypto.randomUUID(),
          user_id: userId,
          task_id: task.id,
          started_at: now,
          completed_at: now,
          reward_amount: task.reward_amount,
          status: 'completed',
          verification_meta: meta,
        };
        getLocalStore().state.task_completions.push(row);
      } else {
        row.status = 'completed';
        row.completed_at = now;
        row.reward_amount = task.reward_amount;
        row.verification_meta = meta;
      }
      getLocalStore().persist();
    }

    return this.creditUserReward(userId, task.reward_amount, 'task_reward', `Task completed: ${task.title}`);
  },

  async getTaskById(taskId: string): Promise<TaskItem | null> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data } = await sb.from('tasks').select('*').eq('id', taskId).maybeSingle();
      if (!data) return null;
      return { ...data, reward_amount: Number(data.reward_amount) } as TaskItem;
    }
    return getLocalStore().state.tasks.find((t) => t.id === taskId) || null;
  },

  async getUserStatsForVerification(userId: string): Promise<{
    referralCount: number;
    completedMiningSessions: number;
    hasVerifiedWallet: boolean;
  }> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const [{ count: refCount }, { count: sessionCount }, { data: wallet }] = await Promise.all([
        sb
          .from('referrals')
          .select('*', { count: 'exact', head: true })
          .eq('referrer_user_id', userId)
          .eq('level', 1),
        sb
          .from('mining_sessions')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'claimed'),
        sb
          .from('user_wallets')
          .select('is_verified,is_suspended')
          .eq('user_id', userId)
          .eq('is_active', true)
          .maybeSingle(),
      ]);
      return {
        referralCount: refCount || 0,
        completedMiningSessions: sessionCount || 0,
        hasVerifiedWallet: Boolean(wallet?.is_verified && !wallet?.is_suspended),
      };
    }

    const referralCount = getLocalStore().state.referrals.filter(
      (r) => r.referrer_user_id === userId && r.level === 1
    ).length;
    const completedMiningSessions = getLocalStore().state.mining_sessions.filter(
      (s) => s.user_id === userId && s.status === 'claimed'
    ).length;
    const wallet = getLocalStore().state.user_wallets.find((w) => w.user_id === userId && w.is_active);
    return {
      referralCount,
      completedMiningSessions,
      hasVerifiedWallet: Boolean(wallet?.is_verified && !wallet?.is_suspended),
    };
  },

  async getReferralDashboard(userId: string) {
    if (await useSupabase()) {
      const sb = getSupabase();
      const [{ data: refs }, { data: rewards }] = await Promise.all([
        sb.from('referrals').select('*').eq('referrer_user_id', userId).order('created_at', { ascending: false }),
        sb
          .from('referral_rewards')
          .select('*')
          .eq('referrer_user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      const refIds = (refs || []).map((r) => r.referred_user_id);
      let userMap = new Map<string, LovaUser>();
      if (refIds.length > 0) {
        const { data: invitedUsers } = await sb.from('users').select('*').in('id', refIds);
        userMap = new Map((invitedUsers || []).map((u) => [u.id, normalizeUserRow(u)]));
      }

      const invited = (refs || []).map((r) => {
        const u = userMap.get(r.referred_user_id);
        return {
          id: r.id,
          level: r.level,
          created_at: r.created_at,
          handle: u ? maskDisplayName(u) : 'Miner',
          total_earned: u ? u.total_earned : 0,
        };
      });
      const totalEarned = (rewards || []).reduce((acc, r) => acc + Number(r.amount), 0);
      return {
        level1Count: invited.filter((i) => i.level === 1).length,
        level2Count: invited.filter((i) => i.level === 2).length,
        totalReferralEarned: Number(totalEarned.toFixed(6)),
        invited,
        rewards: (rewards || []).map((r) => ({ ...r, amount: Number(r.amount) })),
      };
    }

    const refs = getLocalStore().state.referrals.filter((r) => r.referrer_user_id === userId);
    const invited = refs.map((r) => {
      const u = getLocalStore().state.users.find((x) => x.id === r.referred_user_id);
      return {
        id: r.id,
        level: r.level,
        created_at: r.created_at,
        handle: u ? maskDisplayName(u) : 'Miner',
        total_earned: u ? u.total_earned : 0,
      };
    });
    const rewards = getLocalStore().state.referral_rewards
      .filter((r) => r.referrer_user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const totalReferralEarned = Number(rewards.reduce((acc, r) => acc + r.amount, 0).toFixed(6));
    return {
      level1Count: invited.filter((i) => i.level === 1).length,
      level2Count: invited.filter((i) => i.level === 2).length,
      totalReferralEarned,
      invited,
      rewards: rewards.slice(0, 50),
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

    if (await useSupabase()) {
      const sb = getSupabase();
      const { data: users } = await sb.from('users').select('id,telegram_id,username,first_name,total_earned,status');
      const activeUsers = (users || []).filter((u) => u.status === 'active');
      const userMap = new Map(activeUsers.map((u) => [u.id, u]));

      if (tab === 'miners') {
        if (!cutoffIso) {
          return activeUsers
            .sort((a, b) => Number(b.total_earned) - Number(a.total_earned))
            .slice(0, 25)
            .map((u, idx) => ({
              rank: idx + 1,
              userId: u.id,
              handle: maskDisplayName(u),
              score: Number(Number(u.total_earned).toFixed(2)),
              unit: 'LOVA',
            }));
        }
        const { data: rewards } = await sb
          .from('mining_rewards')
          .select('user_id,amount')
          .gte('created_at', cutoffIso);
        const totals = new Map<string, number>();
        for (const r of rewards || []) {
          totals.set(r.user_id, (totals.get(r.user_id) || 0) + Number(r.amount));
        }
        return Array.from(totals.entries())
          .filter(([uid]) => userMap.has(uid))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 25)
          .map(([uid, score], idx) => ({
            rank: idx + 1,
            userId: uid,
            handle: maskDisplayName(userMap.get(uid)!),
            score: Number(score.toFixed(2)),
            unit: 'LOVA',
          }));
      }

      let refQuery = sb.from('referrals').select('referrer_user_id').eq('level', 1);
      if (cutoffIso) refQuery = refQuery.gte('created_at', cutoffIso);
      const { data: refs } = await refQuery;
      const counts = new Map<string, number>();
      for (const r of refs || []) {
        counts.set(r.referrer_user_id, (counts.get(r.referrer_user_id) || 0) + 1);
      }
      return Array.from(counts.entries())
        .filter(([uid]) => userMap.has(uid))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([uid, score], idx) => ({
          rank: idx + 1,
          userId: uid,
          handle: maskDisplayName(userMap.get(uid)!),
          score,
          unit: 'Invites',
        }));
    }

    const activeUsers = getLocalStore().state.users.filter((u) => u.status === 'active');
    const userMap = new Map(activeUsers.map((u) => [u.id, u]));

    if (tab === 'miners') {
      if (!cutoffIso) {
        return activeUsers
          .sort((a, b) => b.total_earned - a.total_earned)
          .slice(0, 25)
          .map((u, idx) => ({
            rank: idx + 1,
            userId: u.id,
            handle: maskDisplayName(u),
            score: Number(u.total_earned.toFixed(2)),
            unit: 'LOVA',
          }));
      }
      const totals = new Map<string, number>();
      for (const r of getLocalStore().state.mining_rewards) {
        if (r.created_at >= cutoffIso) {
          totals.set(r.user_id, (totals.get(r.user_id) || 0) + r.amount);
        }
      }
      return Array.from(totals.entries())
        .filter(([uid]) => userMap.has(uid))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([uid, score], idx) => ({
          rank: idx + 1,
          userId: uid,
          handle: maskDisplayName(userMap.get(uid)!),
          score: Number(score.toFixed(2)),
          unit: 'LOVA',
        }));
    }

    const counts = new Map<string, number>();
    for (const r of getLocalStore().state.referrals) {
      if (r.level === 1 && (!cutoffIso || r.created_at >= cutoffIso)) {
        counts.set(r.referrer_user_id, (counts.get(r.referrer_user_id) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .filter(([uid]) => userMap.has(uid))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([uid, score], idx) => ({
        rank: idx + 1,
        userId: uid,
        handle: maskDisplayName(userMap.get(uid)!),
        score,
        unit: 'Invites',
      }));
  },

  // WALLET & GRAM VERIFICATION
  async getActiveWallet(userId: string): Promise<UserWallet | null> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data } = await sb
        .from('user_wallets')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();
      return (data as UserWallet) || null;
    }
    return getLocalStore().state.user_wallets.find((w) => w.user_id === userId && w.is_active) || null;
  },

  async connectWallet(
    userId: string,
    walletAddress: string,
    rawAddress: string,
    provider: string | null
  ): Promise<UserWallet> {
    const now = new Date().toISOString();
    if (await useSupabase()) {
      const sb = getSupabase();
      // Deactivate previous wallets for user
      await sb.from('user_wallets').update({ is_active: false, updated_at: now }).eq('user_id', userId);

      // Check if user already connected this exact raw_address before
      const { data: existing } = await sb
        .from('user_wallets')
        .select('*')
        .eq('user_id', userId)
        .eq('raw_address', rawAddress)
        .maybeSingle();

      if (existing) {
        const { data, error } = await sb
          .from('user_wallets')
          .update({
            wallet_address: walletAddress,
            wallet_provider: provider,
            is_active: true,
            updated_at: now,
          })
          .eq('id', existing.id)
          .select('*')
          .single();
        if (error) throw new Error(error.message);
        return data as UserWallet;
      }

      // New wallet requires fresh GRAM verification (is_verified: false)
      const { data, error } = await sb
        .from('user_wallets')
        .insert({
          user_id: userId,
          wallet_address: walletAddress,
          raw_address: rawAddress,
          wallet_provider: provider,
          is_active: true,
          is_verified: false,
          is_suspended: false,
        })
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as UserWallet;
    }

    for (const w of getLocalStore().state.user_wallets) {
      if (w.user_id === userId) w.is_active = false;
    }
    const existing = getLocalStore().state.user_wallets.find(
      (w) => w.user_id === userId && w.raw_address === rawAddress
    );
    if (existing) {
      existing.wallet_address = walletAddress;
      existing.wallet_provider = provider;
      existing.is_active = true;
      existing.updated_at = now;
      getLocalStore().persist();
      return existing;
    }
    const wallet: UserWallet = {
      id: crypto.randomUUID(),
      user_id: userId,
      wallet_address: walletAddress,
      raw_address: rawAddress,
      wallet_provider: provider,
      is_active: true,
      is_verified: false,
      is_suspended: false,
      verified_at: null,
      created_at: now,
      updated_at: now,
    };
    getLocalStore().state.user_wallets.push(wallet);
    getLocalStore().persist();
    return wallet;
  },

  async disconnectWallet(userId: string): Promise<void> {
    const now = new Date().toISOString();
    if (await useSupabase()) {
      const sb = getSupabase();
      await sb.from('user_wallets').update({ is_active: false, updated_at: now }).eq('user_id', userId);
      return;
    }
    for (const w of getLocalStore().state.user_wallets) {
      if (w.user_id === userId) {
        w.is_active = false;
        w.updated_at = now;
      }
    }
    getLocalStore().persist();
  },

  async hasTxHashBeenUsed(txHash: string): Promise<boolean> {
    const clean = txHash.trim();
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data } = await sb
        .from('wallet_verifications')
        .select('id')
        .eq('tx_hash', clean)
        .maybeSingle();
      return Boolean(data);
    }
    return getLocalStore().state.wallet_verifications.some((v) => v.tx_hash === clean);
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
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data: ver, error: verErr } = await sb
        .from('wallet_verifications')
        .insert({
          user_id: input.userId,
          wallet_id: input.walletId,
          tx_hash: input.txHash,
          sender_address: input.senderAddress,
          recipient_address: input.recipientAddress,
          jetton_master_address: input.jettonMasterAddress,
          amount_raw: input.amountRaw,
          amount_display: input.amountDisplay,
          decimals: input.decimals,
          status: 'verified',
          verified_at: now,
        })
        .select('*')
        .single();
      if (verErr) throw new Error('Transaction hash already used or invalid.');

      const { data: wallet, error: wErr } = await sb
        .from('user_wallets')
        .update({ is_verified: true, verified_at: now, updated_at: now })
        .eq('id', input.walletId)
        .select('*')
        .single();
      if (wErr) throw new Error(wErr.message);

      await sb.from('transactions').insert({
        user_id: input.userId,
        tx_type: 'gram_verification',
        amount: input.amountDisplay,
        currency: 'GRAM',
        chain_tx_hash: input.txHash,
        description: `Verified TON wallet via ${input.amountDisplay} GRAM Jetton transfer`,
        is_demo: false,
      });

      return { wallet: wallet as UserWallet, verification: ver as WalletVerification };
    }

    if (getLocalStore().state.wallet_verifications.some((v) => v.tx_hash === input.txHash)) {
      throw new Error('Duplicate transaction hash detected (replay prevented).');
    }
    const ver: WalletVerification = {
      id: crypto.randomUUID(),
      user_id: input.userId,
      wallet_id: input.walletId,
      tx_hash: input.txHash,
      sender_address: input.senderAddress,
      recipient_address: input.recipientAddress,
      jetton_master_address: input.jettonMasterAddress,
      amount_raw: input.amountRaw,
      amount_display: input.amountDisplay,
      decimals: input.decimals,
      status: 'verified',
      verified_at: now,
      created_at: now,
    };
    getLocalStore().state.wallet_verifications.unshift(ver);
    const wallet = getLocalStore().state.user_wallets.find((w) => w.id === input.walletId)!;
    wallet.is_verified = true;
    wallet.verified_at = now;
    wallet.updated_at = now;
    getLocalStore().state.transactions.unshift({
      id: crypto.randomUUID(),
      user_id: input.userId,
      tx_type: 'gram_verification',
      amount: input.amountDisplay,
      currency: 'GRAM',
      chain_tx_hash: input.txHash,
      description: `Verified TON wallet via ${input.amountDisplay} GRAM Jetton transfer`,
      is_demo: false,
      created_at: now,
    });
    getLocalStore().persist();
    return { wallet, verification: ver };
  },

  async getUserWalletVerifications(userId: string): Promise<WalletVerification[]> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data } = await sb
        .from('wallet_verifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      return (data || []) as WalletVerification[];
    }
    return getLocalStore().state.wallet_verifications.filter((v) => v.user_id === userId);
  },

  // WITHDRAWALS (Enforces 0.05 GRAM KYC verification)
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
    const isDemo = false;
    const now = new Date().toISOString();

    if (await useSupabase()) {
      const sb = getSupabase();
      const nextAvail = Number((user.available_balance - cleanAmount).toFixed(6));
      const nextPending = Number((user.pending_balance + cleanAmount).toFixed(6));
      const { data: uData, error: uErr } = await sb
        .from('users')
        .update({ available_balance: nextAvail, pending_balance: nextPending, updated_at: now })
        .eq('id', user.id)
        .gte('available_balance', cleanAmount)
        .select('*')
        .single();
      if (uErr || !uData) throw new Error('Insufficient balance for withdrawal.');

      const { data: wData, error: wErr } = await sb
        .from('withdrawals')
        .insert({
          user_id: user.id,
          destination_address: destinationAddress,
          amount: cleanAmount,
          is_demo_request: isDemo,
          status: 'Pending',
        })
        .select('*')
        .single();
      if (wErr) throw new Error(wErr.message);

      await sb.from('transactions').insert({
        user_id: user.id,
        tx_type: 'withdrawal_request',
        amount: cleanAmount,
        currency: 'LOVA',
        chain_tx_hash: null,
        description: `Withdrawal requested to ${destinationAddress.slice(0, 8)}...${destinationAddress.slice(-6)}`,
        is_demo: isDemo,
      });

      return {
        user: normalizeUserRow(uData),
        withdrawal: { ...wData, amount: Number(wData.amount) } as WithdrawalItem,
      };
    }

    const target = getLocalStore().state.users.find((u) => u.id === user.id)!;
    target.available_balance = Number((target.available_balance - cleanAmount).toFixed(6));
    target.pending_balance = Number((target.pending_balance + cleanAmount).toFixed(6));
    const withdrawal: WithdrawalItem = {
      id: crypto.randomUUID(),
      user_id: user.id,
      destination_address: destinationAddress,
      amount: cleanAmount,
      is_demo_request: isDemo,
      status: 'Pending',
      payout_tx_hash: null,
      admin_note: null,
      reviewed_at: null,
      paid_at: null,
      created_at: now,
    };
    getLocalStore().state.withdrawals.unshift(withdrawal);
    getLocalStore().state.transactions.unshift({
      id: crypto.randomUUID(),
      user_id: user.id,
      tx_type: 'withdrawal_request',
      amount: cleanAmount,
      currency: 'LOVA',
      chain_tx_hash: null,
      description: `Withdrawal requested to ${destinationAddress.slice(0, 8)}...${destinationAddress.slice(-6)}`,
      is_demo: isDemo,
      created_at: now,
    });
    getLocalStore().persist();
    return { user: target, withdrawal };
  },

  async getUserWithdrawals(userId: string): Promise<WithdrawalItem[]> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data } = await sb
        .from('withdrawals')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      return (data || []).map((w) => ({ ...w, amount: Number(w.amount) })) as WithdrawalItem[];
    }
    return getLocalStore().state.withdrawals.filter((w) => w.user_id === userId);
  },

  async getUserTransactions(userId: string): Promise<TransactionItem[]> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data } = await sb
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      return (data || []).map((t) => ({ ...t, amount: Number(t.amount) })) as TransactionItem[];
    }
    return getLocalStore().state.transactions.filter((t) => t.user_id === userId).slice(0, 50);
  },

  async getAnnouncements(includeInactive = false): Promise<AnnouncementItem[]> {
    if (await useSupabase()) {
      const sb = getSupabase();
      let q = sb.from('announcements').select('*').order('created_at', { ascending: false });
      if (!includeInactive) q = q.eq('is_active', true);
      const { data } = await q;
      return (data || []) as AnnouncementItem[];
    }
    return getLocalStore().state.announcements
      .filter((a) => includeInactive || a.is_active)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  },

  // ============================================================================
  // ADMIN REPOSITORY METHODS
  // ============================================================================
  async getAdminsCount(): Promise<number> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { count } = await sb.from('admins').select('*', { count: 'exact', head: true });
      return count || 0;
    }
    return getLocalStore().state.admins.length;
  },

  async getAdminByTelegramId(telegramId: number): Promise<AdminRecord | null> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data } = await sb
        .from('admins')
        .select('*')
        .eq('telegram_id', telegramId)
        .eq('is_active', true)
        .maybeSingle();
      return (data as AdminRecord) || null;
    }
    return (
      getLocalStore().state.admins.find((a) => a.telegram_id === telegramId && a.is_active) || null
    );
  },

  async upsertAdmin(input: {
    telegram_id: number | null;
    email: string | null;
    display_name: string;
    role: AdminRole;
  }): Promise<AdminRecord> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('admins')
        .upsert(
          {
            telegram_id: input.telegram_id,
            email: input.email,
            display_name: input.display_name,
            role: input.role,
            is_active: true,
          },
          { onConflict: input.telegram_id ? 'telegram_id' : 'email' }
        )
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as AdminRecord;
    }

    const existing = getLocalStore().state.admins.find(
      (a) =>
        (input.telegram_id && a.telegram_id === input.telegram_id) ||
        (input.email && a.email === input.email)
    );
    if (existing) {
      existing.role = input.role;
      existing.display_name = input.display_name;
      existing.is_active = true;
      getLocalStore().persist();
      return existing;
    }
    const created: AdminRecord = {
      id: crypto.randomUUID(),
      telegram_id: input.telegram_id,
      email: input.email,
      display_name: input.display_name,
      role: input.role,
      is_active: true,
      created_at: new Date().toISOString(),
    };
    getLocalStore().state.admins.push(created);
    getLocalStore().persist();
    return created;
  },

  async listAdmins(): Promise<AdminRecord[]> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data } = await sb.from('admins').select('*').order('created_at', { ascending: false });
      return (data || []) as AdminRecord[];
    }
    return [...getLocalStore().state.admins].sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
  },

  async toggleAdminActive(adminId: string, isActive: boolean): Promise<AdminRecord> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('admins')
        .update({ is_active: isActive })
        .eq('id', adminId)
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as AdminRecord;
    }
    const admin = getLocalStore().state.admins.find((a) => a.id === adminId);
    if (!admin) throw new Error('Admin record not found');
    admin.is_active = isActive;
    getLocalStore().persist();
    return admin;
  },

  async writeAuditLog(entry: Omit<AdminAuditLogRow, 'id' | 'created_at'>): Promise<void> {
    if (await useSupabase()) {
      const sb = getSupabase();
      await sb.from('admin_audit_logs').insert(entry);
      return;
    }
    getLocalStore().state.admin_audit_logs.unshift({
      ...entry,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    });
    if (getLocalStore().state.admin_audit_logs.length > 500) {
      getLocalStore().state.admin_audit_logs = getLocalStore().state.admin_audit_logs.slice(0, 500);
    }
    getLocalStore().persist();
  },

  async getAdminOverview() {
    const dayAgo = new Date(Date.now() - 86400000).toISOString();
    if (await useSupabase()) {
      const sb = getSupabase();
      const [
        { count: totalUsers },
        { count: activeUsers },
        { data: rewards },
        { data: withdrawals },
        { count: totalReferrals },
        { data: verifications },
        { count: activeMiners },
        { count: pendingLevelUpgrades },
      ] = await Promise.all([
        sb.from('users').select('*', { count: 'exact', head: true }),
        sb.from('users').select('*', { count: 'exact', head: true }).gte('last_active_at', dayAgo),
        sb.from('mining_rewards').select('amount'),
        sb.from('withdrawals').select('status,amount'),
        sb.from('referrals').select('*', { count: 'exact', head: true }),
        sb.from('wallet_verifications').select('amount_display,status').eq('status', 'verified'),
        sb.from('mining_sessions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        sb.from('level_upgrade_requests').select('*', { count: 'exact', head: true }).eq('status', 'Pending'),
      ]);

      const totalMiningRewards = (rewards || []).reduce((a, r) => a + Number(r.amount), 0);
      const pendingWithdrawals = (withdrawals || []).filter((w) => w.status === 'Pending').length;
      const completedWithdrawals = (withdrawals || []).filter((w) => w.status === 'Paid').length;
      const totalGramFees = (verifications || []).reduce((a, v) => a + Number(v.amount_display), 0);

      return {
        totalUsers: totalUsers || 0,
        activeUsers: activeUsers || 0,
        activeMiners: activeMiners || 0,
        totalMiningRewards: Number(totalMiningRewards.toFixed(4)),
        pendingWithdrawals,
        completedWithdrawals,
        totalReferrals: totalReferrals || 0,
        verifiedWalletsCount: (verifications || []).length,
        totalGramFeesReceived: Number(totalGramFees.toFixed(4)),
        pendingLevelUpgrades: pendingLevelUpgrades || 0,
      };
    }

    const s = getLocalStore().state;
    const totalMiningRewards = s.mining_rewards.reduce((a, r) => a + r.amount, 0);
    const totalGramFees = s.wallet_verifications
      .filter((v) => v.status === 'verified')
      .reduce((a, v) => a + v.amount_display, 0);

    return {
      totalUsers: s.users.length,
      activeUsers: s.users.filter((u) => u.last_active_at >= dayAgo).length,
      activeMiners: s.mining_sessions.filter((m) => m.status === 'active').length,
      totalMiningRewards: Number(totalMiningRewards.toFixed(4)),
      pendingWithdrawals: s.withdrawals.filter((w) => w.status === 'Pending').length,
      completedWithdrawals: s.withdrawals.filter((w) => w.status === 'Paid').length,
      totalReferrals: s.referrals.length,
      verifiedWalletsCount: s.wallet_verifications.filter((v) => v.status === 'verified').length,
      totalGramFeesReceived: Number(totalGramFees.toFixed(4)),
      pendingLevelUpgrades: s.level_upgrade_requests.filter((r) => r.status === 'Pending').length,
    };
  },

  async listAdminUsers(search?: string) {
    if (await useSupabase()) {
      const sb = getSupabase();
      let q = sb.from('users').select('*').order('created_at', { ascending: false }).limit(100);
      if (search && /^\d+$/.test(search.trim())) {
        q = sb.from('users').select('*').eq('telegram_id', Number(search.trim()));
      } else if (search && search.trim()) {
        q = sb
          .from('users')
          .select('*')
          .ilike('username', `%${search.trim()}%`)
          .limit(50);
      }
      const [{ data: users }, { data: wallets }] = await Promise.all([
        q,
        sb.from('user_wallets').select('*').eq('is_active', true),
      ]);
      const walletMap = new Map((wallets || []).map((w) => [w.user_id, w as UserWallet]));
      return (users || []).map((u) => ({
        ...normalizeUserRow(u),
        wallet: walletMap.get(u.id) || null,
      }));
    }

    const q = (search || '').trim().toLowerCase();
    return getLocalStore().state.users
      .filter((u) => {
        if (!q) return true;
        return (
          String(u.telegram_id).includes(q) ||
          (u.username || '').toLowerCase().includes(q) ||
          (u.first_name || '').toLowerCase().includes(q)
        );
      })
      .map((u) => ({
        ...u,
        wallet: getLocalStore().state.user_wallets.find((w) => w.user_id === u.id && w.is_active) || null,
      }));
  },

  async setUserStatus(userId: string, status: UserStatus, reason?: string): Promise<LovaUser> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('users')
        .update({ status, ban_reason: reason || null, updated_at: new Date().toISOString() })
        .eq('id', userId)
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return normalizeUserRow(data);
    }
    const u = getLocalStore().state.users.find((x) => x.id === userId);
    if (!u) throw new Error('User not found');
    u.status = status;
    u.ban_reason = reason || null;
    getLocalStore().persist();
    return u;
  },

  async listAdminWithdrawals(): Promise<WithdrawalItem[]> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const [{ data: rows }, { data: users }] = await Promise.all([
        sb.from('withdrawals').select('*').order('created_at', { ascending: false }).limit(100),
        sb.from('users').select('id,telegram_id,username,first_name'),
      ]);
      const userMap = new Map((users || []).map((u) => [u.id, u]));
      return (rows || []).map((w) => {
        const u = userMap.get(w.user_id);
        return {
          ...w,
          amount: Number(w.amount),
          telegram_id: u?.telegram_id,
          user_handle: u?.username ? `@${u.username}` : u?.first_name || String(u?.telegram_id || ''),
        } as WithdrawalItem;
      });
    }
    return getLocalStore().state.withdrawals.map((w) => {
      const u = getLocalStore().state.users.find((x) => x.id === w.user_id);
      return {
        ...w,
        telegram_id: u?.telegram_id,
        user_handle: u?.username ? `@${u.username}` : u?.first_name || String(u?.telegram_id || ''),
      };
    });
  },

  async processWithdrawalAction(input: {
    withdrawalId: string;
    action: 'approve' | 'reject' | 'mark_paid';
    adminId: string;
    adminNote?: string;
    payoutTxHash?: string;
  }): Promise<WithdrawalItem> {
    const now = new Date().toISOString();

    if (await useSupabase()) {
      const sb = getSupabase();
      const { data: w } = await sb.from('withdrawals').select('*').eq('id', input.withdrawalId).single();
      if (!w) throw new Error('Withdrawal not found');

      const { data: user } = await sb.from('users').select('*').eq('id', w.user_id).single();
      if (!user) throw new Error('User not found');

      const amt = Number(w.amount);

      if (input.action === 'approve') {
        if (w.status !== 'Pending') throw new Error('Only Pending withdrawals can be approved.');
        const { data, error } = await sb
          .from('withdrawals')
          .update({
            status: 'Approved',
            admin_note: input.adminNote || null,
            reviewed_by_admin_id: input.adminId,
            reviewed_at: now,
            updated_at: now,
          })
          .eq('id', w.id)
          .select('*')
          .single();
        if (error) throw new Error(error.message);
        return { ...data, amount: Number(data.amount) } as WithdrawalItem;
      }

      if (input.action === 'reject') {
        if (w.status === 'Paid' || w.status === 'Rejected') {
          throw new Error('Cannot reject a withdrawal already Paid or Rejected.');
        }
        await sb
          .from('users')
          .update({
            available_balance: Number((Number(user.available_balance) + amt).toFixed(6)),
            pending_balance: Math.max(0, Number((Number(user.pending_balance) - amt).toFixed(6))),
          })
          .eq('id', user.id);

        const { data, error } = await sb
          .from('withdrawals')
          .update({
            status: 'Rejected',
            admin_note: input.adminNote || 'Rejected by admin',
            reviewed_by_admin_id: input.adminId,
            reviewed_at: now,
            updated_at: now,
          })
          .eq('id', w.id)
          .select('*')
          .single();
        if (error) throw new Error(error.message);

        await sb.from('transactions').insert({
          user_id: user.id,
          tx_type: 'withdrawal_refund',
          amount: amt,
          currency: 'LOVA',
          description: `Withdrawal rejected & refunded (${input.adminNote || 'Admin review'})`,
          is_demo: w.is_demo_request,
        });

        return { ...data, amount: Number(data.amount) } as WithdrawalItem;
      }

      // mark_paid
      if (w.status !== 'Approved' && w.status !== 'Pending') {
        throw new Error('Withdrawal must be Pending or Approved before marking Paid.');
      }
      await sb
        .from('users')
        .update({
          pending_balance: Math.max(0, Number((Number(user.pending_balance) - amt).toFixed(6))),
          total_withdrawn: Number((Number(user.total_withdrawn) + amt).toFixed(6)),
        })
        .eq('id', user.id);

      const { data, error } = await sb
        .from('withdrawals')
        .update({
          status: 'Paid',
          payout_tx_hash: input.payoutTxHash || null,
          admin_note: input.adminNote || null,
          reviewed_by_admin_id: input.adminId,
          reviewed_at: w.reviewed_at || now,
          paid_at: now,
          updated_at: now,
        })
        .eq('id', w.id)
        .select('*')
        .single();
      if (error) throw new Error(error.message);

      await sb.from('transactions').insert({
        user_id: user.id,
        tx_type: 'withdrawal_paid',
        amount: amt,
        currency: 'LOVA',
        chain_tx_hash: input.payoutTxHash || null,
        description: `Withdrawal paid on TON (${input.payoutTxHash?.slice(0, 10)}...)`,
        is_demo: false,
      });

      return { ...data, amount: Number(data.amount) } as WithdrawalItem;
    }

    const w = getLocalStore().state.withdrawals.find((x) => x.id === input.withdrawalId);
    if (!w) throw new Error('Withdrawal not found');
    const u = getLocalStore().state.users.find((x) => x.id === w.user_id)!;

    if (input.action === 'approve') {
      if (w.status !== 'Pending') throw new Error('Only Pending withdrawals can be approved.');
      w.status = 'Approved';
      w.admin_note = input.adminNote || null;
      w.reviewed_at = now;
    } else if (input.action === 'reject') {
      if (w.status === 'Paid' || w.status === 'Rejected') {
        throw new Error('Cannot reject a withdrawal already Paid or Rejected.');
      }
      u.available_balance = Number((u.available_balance + w.amount).toFixed(6));
      u.pending_balance = Math.max(0, Number((u.pending_balance - w.amount).toFixed(6)));
      w.status = 'Rejected';
      w.admin_note = input.adminNote || 'Rejected by admin';
      w.reviewed_at = now;
      getLocalStore().state.transactions.unshift({
        id: crypto.randomUUID(),
        user_id: u.id,
        tx_type: 'withdrawal_refund',
        amount: w.amount,
        currency: 'LOVA',
        chain_tx_hash: null,
        description: `Withdrawal rejected & refunded`,
        is_demo: w.is_demo_request,
        created_at: now,
      });
    } else if (input.action === 'mark_paid') {
      if (w.status !== 'Approved' && w.status !== 'Pending') {
        throw new Error('Withdrawal must be Pending or Approved before marking Paid.');
      }
      u.pending_balance = Math.max(0, Number((u.pending_balance - w.amount).toFixed(6)));
      u.total_withdrawn = Number((u.total_withdrawn + w.amount).toFixed(6));
      w.status = 'Paid';
      w.payout_tx_hash = input.payoutTxHash || null;
      w.admin_note = input.adminNote || null;
      w.reviewed_at = w.reviewed_at || now;
      w.paid_at = now;
      getLocalStore().state.transactions.unshift({
        id: crypto.randomUUID(),
        user_id: u.id,
        tx_type: 'withdrawal_paid',
        amount: w.amount,
        currency: 'LOVA',
        chain_tx_hash: input.payoutTxHash || null,
        description: `Withdrawal paid on TON`,
        is_demo: false,
        created_at: now,
      });
    }
    getLocalStore().persist();
    return w;
  },

  async listAdminWalletsAndPayments() {
    if (await useSupabase()) {
      const sb = getSupabase();
      const [{ data: wallets }, { data: verifications }, { data: users }] = await Promise.all([
        sb.from('user_wallets').select('*').order('updated_at', { ascending: false }).limit(100),
        sb.from('wallet_verifications').select('*').order('created_at', { ascending: false }).limit(100),
        sb.from('users').select('id,telegram_id,username'),
      ]);
      const uMap = new Map((users || []).map((u) => [u.id, u]));
      return {
        wallets: (wallets || []).map((w) => ({
          ...w,
          telegram_id: uMap.get(w.user_id)?.telegram_id,
          username: uMap.get(w.user_id)?.username,
        })),
        verifications: (verifications || []) as WalletVerification[],
      };
    }
    const uMap = new Map(getLocalStore().state.users.map((u) => [u.id, u]));
    return {
      wallets: getLocalStore().state.user_wallets.map((w) => ({
        ...w,
        telegram_id: uMap.get(w.user_id)?.telegram_id,
        username: uMap.get(w.user_id)?.username,
      })),
      verifications: getLocalStore().state.wallet_verifications,
    };
  },

  async toggleWalletSuspension(walletId: string, suspended: boolean): Promise<UserWallet> {
    const now = new Date().toISOString();
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('user_wallets')
        .update({ is_suspended: suspended, updated_at: now })
        .eq('id', walletId)
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as UserWallet;
    }
    const w = getLocalStore().state.user_wallets.find((x) => x.id === walletId);
    if (!w) throw new Error('Wallet not found');
    w.is_suspended = suspended;
    w.updated_at = now;
    getLocalStore().persist();
    return w;
  },

  async createOrUpdateTask(taskInput: Partial<TaskItem> & { id?: string }): Promise<TaskItem> {
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

    if (await useSupabase()) {
      const sb = getSupabase();
      if (taskInput.id) {
        const { data, error } = await sb
          .from('tasks')
          .update({ ...cleanPayload, updated_at: new Date().toISOString() })
          .eq('id', taskInput.id)
          .select('*')
          .single();
        if (error) throw new Error(error.message);
        return { ...data, reward_amount: Number(data.reward_amount) } as TaskItem;
      }
      const { data, error } = await sb
        .from('tasks')
        .insert(cleanPayload)
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return { ...data, reward_amount: Number(data.reward_amount) } as TaskItem;
    }

    if (taskInput.id) {
      const idx = getLocalStore().state.tasks.findIndex((t) => t.id === taskInput.id);
      if (idx === -1) throw new Error('Task not found');
      getLocalStore().state.tasks[idx] = { ...getLocalStore().state.tasks[idx], ...cleanPayload };
      getLocalStore().persist();
      return getLocalStore().state.tasks[idx];
    }

    const created: TaskItem = {
      id: crypto.randomUUID(),
      ...cleanPayload,
    };
    getLocalStore().state.tasks.push(created);
    getLocalStore().persist();
    return created;
  },

  async deleteTask(taskId: string): Promise<void> {
    if (await useSupabase()) {
      const sb = getSupabase();
      await sb.from('tasks').delete().eq('id', taskId);
      return;
    }
    getLocalStore().state.tasks = getLocalStore().state.tasks.filter((t) => t.id !== taskId);
    getLocalStore().persist();
  },

  async createAnnouncement(input: Omit<AnnouncementItem, 'id' | 'created_at'>): Promise<AnnouncementItem> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data, error } = await sb.from('announcements').insert(input).select('*').single();
      if (error) throw new Error(error.message);
      return data as AnnouncementItem;
    }
    const created: AnnouncementItem = {
      ...input,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    getLocalStore().state.announcements.unshift(created);
    getLocalStore().persist();
    return created;
  },

  async deleteAnnouncement(id: string): Promise<void> {
    if (await useSupabase()) {
      const sb = getSupabase();
      await sb.from('announcements').delete().eq('id', id);
      return;
    }
    getLocalStore().state.announcements = getLocalStore().state.announcements.filter((a) => a.id !== id);
    getLocalStore().persist();
  },

  async listAdminReferrals() {
    if (await useSupabase()) {
      const sb = getSupabase();
      const [{ data: refs }, { data: rewards }, { data: users }] = await Promise.all([
        sb.from('referrals').select('*').order('created_at', { ascending: false }).limit(100),
        sb.from('referral_rewards').select('*').order('created_at', { ascending: false }).limit(100),
        sb.from('users').select('id,telegram_id,username'),
      ]);
      const uMap = new Map((users || []).map((u) => [u.id, u]));
      return {
        referrals: (refs || []).map((r) => ({
          ...r,
          referrer_handle: uMap.get(r.referrer_user_id)?.username || uMap.get(r.referrer_user_id)?.telegram_id,
          referred_handle: uMap.get(r.referred_user_id)?.username || uMap.get(r.referred_user_id)?.telegram_id,
        })),
        rewards: (rewards || []).map((rw) => ({ ...rw, amount: Number(rw.amount) })),
      };
    }
    const uMap = new Map(getLocalStore().state.users.map((u) => [u.id, u]));
    return {
      referrals: getLocalStore().state.referrals.map((r) => ({
        ...r,
        referrer_handle: uMap.get(r.referrer_user_id)?.username || uMap.get(r.referrer_user_id)?.telegram_id,
        referred_handle: uMap.get(r.referred_user_id)?.username || uMap.get(r.referred_user_id)?.telegram_id,
      })),
      rewards: getLocalStore().state.referral_rewards.slice(0, 100),
    };
  },

  async listAuditLogs(): Promise<AdminAuditLogRow[]> {
    if (await useSupabase()) {
      const sb = getSupabase();
      const { data } = await sb
        .from('admin_audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      return (data || []) as AdminAuditLogRow[];
    }
    return getLocalStore().state.admin_audit_logs.slice(0, 100);
  },

  // ============================================================================
  // MEMBERSHIP LEVELS & EXTERNAL LOVA LEVEL-UP PAYMENTS
  // (Strictly never deducts from user's in-app mining / reward / available balance)
  // ============================================================================
  async getMembershipLevels(includeInactive = false): Promise<MembershipLevel[]> {
    if (await useSupabase()) {
      const sb = getSupabase();
      let q = sb.from('membership_levels').select('*').order('level_number', { ascending: true });
      if (!includeInactive) q = q.eq('is_active', true);
      const { data, error } = await q;
      if (error || !data || data.length === 0) {
        return DEFAULT_MEMBERSHIP_LEVELS.filter((l) => includeInactive || l.is_active);
      }
      return data.map(normalizeMembershipLevelRow);
    }
    return [...getLocalStore().state.membership_levels]
      .filter((l) => includeInactive || l.is_active)
      .sort((a, b) => a.level_number - b.level_number);
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
    const updatedRow: MembershipLevel = {
      level_number: levelNumber,
      name: (input.name ?? existing.name).trim().slice(0, 60) || `Level ${levelNumber}`,
      badge_label: (input.badge_label ?? existing.badge_label).trim().slice(0, 20) || `LVL ${levelNumber}`,
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

    if (await useSupabase()) {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('membership_levels')
        .upsert(
          {
            ...updatedRow,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'level_number' }
        )
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return normalizeMembershipLevelRow(data);
    }

    const idx = getLocalStore().state.membership_levels.findIndex(
      (l) => l.level_number === levelNumber
    );
    if (idx === -1) {
      getLocalStore().state.membership_levels.push(updatedRow);
    } else {
      getLocalStore().state.membership_levels[idx] = updatedRow;
    }
    getLocalStore().persist();
    return updatedRow;
  },

  async getUserLevelUpgradeRequests(userId: string): Promise<LevelUpgradeRequest[]> {
    const levels = await this.getMembershipLevels(true);
    const levelNameMap = new Map(levels.map((l) => [l.level_number, l.name]));

    if (await useSupabase()) {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('level_upgrade_requests')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) return [];
      return (data || []).map((row) => ({
        ...normalizeLevelUpgradeRow(row),
        target_level_name: levelNameMap.get(Number(row.target_level)) || `Level ${row.target_level}`,
      }));
    }

    return getLocalStore().state.level_upgrade_requests
      .filter((r) => r.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 50)
      .map((r) => ({
        ...r,
        target_level_name: levelNameMap.get(r.target_level) || `Level ${r.target_level}`,
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

    const now = new Date().toISOString();

    if (await useSupabase()) {
      const sb = getSupabase();

      const [{ data: existingPending }, { data: dupUpgrade }, { data: dupGram }] = await Promise.all([
        sb
          .from('level_upgrade_requests')
          .select('id')
          .eq('user_id', input.user.id)
          .eq('status', 'Pending')
          .limit(1),
        sb.from('level_upgrade_requests').select('id').eq('tx_hash', cleanTx).maybeSingle(),
        sb.from('wallet_verifications').select('id').eq('tx_hash', cleanTx).maybeSingle(),
      ]);

      if (existingPending && existingPending.length > 0) {
        throw new Error(
          'You already have a Pending level-up payment under review. Please wait for admin verification.'
        );
      }
      if (dupUpgrade || dupGram) {
        throw new Error('This transaction hash has already been submitted.');
      }

      // IMPORTANT: Never deduct or touch users.available_balance, pending_balance, or total_earned.
      const { data, error } = await sb
        .from('level_upgrade_requests')
        .insert({
          user_id: input.user.id,
          from_level: input.user.membership_level || 1,
          target_level: targetTier.level_number,
          required_lova_amount: targetTier.required_lova_amount,
          admin_wallet_address: input.adminWalletAddress,
          sender_wallet_address: input.senderWalletAddress || null,
          tx_hash: cleanTx,
          status: 'Pending',
          created_at: now,
          updated_at: now,
        })
        .select('*')
        .single();
      if (error) {
        if (error.message.includes('duplicate') || error.code === '23505') {
          throw new Error('This transaction hash has already been submitted.');
        }
        throw new Error(error.message);
      }
      return {
        ...normalizeLevelUpgradeRow(data),
        target_level_name: targetTier.name,
      };
    }

    const s = getLocalStore().state;
    if (s.level_upgrade_requests.some((r) => r.user_id === input.user.id && r.status === 'Pending')) {
      throw new Error(
        'You already have a Pending level-up payment under review. Please wait for admin verification.'
      );
    }
    if (
      s.level_upgrade_requests.some((r) => r.tx_hash.toLowerCase() === cleanTx.toLowerCase()) ||
      s.wallet_verifications.some((v) => v.tx_hash.toLowerCase() === cleanTx.toLowerCase())
    ) {
      throw new Error('This transaction hash has already been submitted.');
    }

    const row: LevelUpgradeRequest = {
      id: crypto.randomUUID(),
      user_id: input.user.id,
      from_level: input.user.membership_level || 1,
      target_level: targetTier.level_number,
      target_level_name: targetTier.name,
      required_lova_amount: targetTier.required_lova_amount,
      admin_wallet_address: input.adminWalletAddress,
      sender_wallet_address: input.senderWalletAddress || null,
      tx_hash: cleanTx,
      status: 'Pending',
      admin_note: null,
      reviewed_by_admin_id: null,
      reviewed_at: null,
      created_at: now,
      updated_at: now,
    };
    s.level_upgrade_requests.unshift(row);
    getLocalStore().persist();
    return row;
  },

  async listAdminLevelUpgrades(): Promise<LevelUpgradeRequest[]> {
    const levels = await this.getMembershipLevels(true);
    const levelNameMap = new Map(levels.map((l) => [l.level_number, l.name]));

    if (await useSupabase()) {
      const sb = getSupabase();
      const [{ data: rows, error }, { data: users }] = await Promise.all([
        sb
          .from('level_upgrade_requests')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(150),
        sb.from('users').select('id,telegram_id,username,first_name'),
      ]);
      if (error) return [];
      const userMap = new Map((users || []).map((u) => [u.id, u]));
      return (rows || []).map((r) => {
        const u = userMap.get(r.user_id);
        return {
          ...normalizeLevelUpgradeRow(r),
          target_level_name: levelNameMap.get(Number(r.target_level)) || `Level ${r.target_level}`,
          telegram_id: u?.telegram_id,
          user_handle: u?.username ? `@${u.username}` : u?.first_name || String(u?.telegram_id || ''),
        };
      });
    }

    const userMap = new Map(getLocalStore().state.users.map((u) => [u.id, u]));
    return getLocalStore().state.level_upgrade_requests
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => {
        const u = userMap.get(r.user_id);
        return {
          ...r,
          target_level_name: levelNameMap.get(r.target_level) || `Level ${r.target_level}`,
          telegram_id: u?.telegram_id,
          user_handle: u?.username ? `@${u.username}` : u?.first_name || String(u?.telegram_id || ''),
        };
      });
  },

  async processLevelUpgradeAction(input: {
    requestId: string;
    action: 'approve' | 'reject';
    adminId: string;
    adminNote?: string | null;
  }): Promise<{ request: LevelUpgradeRequest; user: LovaUser }> {
    const now = new Date().toISOString();

    if (await useSupabase()) {
      const sb = getSupabase();
      const { data: reqRow, error: rErr } = await sb
        .from('level_upgrade_requests')
        .select('*')
        .eq('id', input.requestId)
        .single();
      if (rErr || !reqRow) throw new Error('Level upgrade request not found.');
      if (reqRow.status !== 'Pending') {
        throw new Error(`Request already processed (${reqRow.status}).`);
      }

      const { data: userRow, error: uErr } = await sb
        .from('users')
        .select('*')
        .eq('id', reqRow.user_id)
        .single();
      if (uErr || !userRow) throw new Error('User account not found.');

      const nextStatus = input.action === 'approve' ? 'Approved' : 'Rejected';
      const { data: updatedReq, error: updReqErr } = await sb
        .from('level_upgrade_requests')
        .update({
          status: nextStatus,
          admin_note: input.adminNote || (input.action === 'reject' ? 'Payment could not be verified' : null),
          reviewed_by_admin_id: input.adminId,
          reviewed_at: now,
          updated_at: now,
        })
        .eq('id', reqRow.id)
        .eq('status', 'Pending')
        .select('*')
        .single();
      if (updReqErr || !updatedReq) {
        throw new Error('Request could not be updated or was already reviewed.');
      }

      let updatedUser = normalizeUserRow(userRow);
      if (input.action === 'approve') {
        const nextLevel = Math.max(Number(userRow.membership_level || 1), Number(reqRow.target_level));
        const { data: uUpdated, error: uUpdErr } = await sb
          .from('users')
          .update({
            membership_level: nextLevel,
            membership_updated_at: now,
            updated_at: now,
          })
          .eq('id', userRow.id)
          .select('*')
          .single();
        if (uUpdErr || !uUpdated) throw new Error('Failed to upgrade user membership level.');
        updatedUser = normalizeUserRow(uUpdated);
      }

      return { request: normalizeLevelUpgradeRow(updatedReq), user: updatedUser };
    }

    const s = getLocalStore().state;
    const reqRow = s.level_upgrade_requests.find((r) => r.id === input.requestId);
    if (!reqRow) throw new Error('Level upgrade request not found.');
    if (reqRow.status !== 'Pending') {
      throw new Error(`Request already processed (${reqRow.status}).`);
    }
    const userRow = s.users.find((u) => u.id === reqRow.user_id);
    if (!userRow) throw new Error('User account not found.');

    reqRow.status = input.action === 'approve' ? 'Approved' : 'Rejected';
    reqRow.admin_note =
      input.adminNote || (input.action === 'reject' ? 'Payment could not be verified' : null);
    reqRow.reviewed_by_admin_id = input.adminId;
    reqRow.reviewed_at = now;
    reqRow.updated_at = now;

    if (input.action === 'approve') {
      userRow.membership_level = Math.max(userRow.membership_level || 1, reqRow.target_level);
      userRow.membership_updated_at = now;
    }

    getLocalStore().persist();
    return { request: reqRow, user: userRow };
  },
};

function normalizeUserRow(row: Record<string, unknown>): LovaUser {
  return {
    ...(row as unknown as LovaUser),
    available_balance: Number(row.available_balance || 0),
    pending_balance: Number(row.pending_balance || 0),
    total_earned: Number(row.total_earned || 0),
    total_withdrawn: Number(row.total_withdrawn || 0),
    streak_days: Number(row.streak_days || 0),
    membership_level: Number(row.membership_level || 1),
    membership_updated_at: (row.membership_updated_at as string | null) ?? null,
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
    benefits: Array.isArray(row.benefits) ? row.benefits.map(String) : [],
    is_active: row.is_active !== false,
  };
}

function normalizeLevelUpgradeRow(row: Record<string, unknown>): LevelUpgradeRequest {
  return {
    ...(row as unknown as LevelUpgradeRequest),
    from_level: Number(row.from_level || 1),
    target_level: Number(row.target_level || 2),
    required_lova_amount: Number(row.required_lova_amount || 0),
  };
}

function normalizeSessionRow(row: Record<string, unknown>): MiningSession {
  return {
    ...(row as unknown as MiningSession),
    reward_rate_per_sec: Number(row.reward_rate_per_sec || 0),
    duration_seconds: Number(row.duration_seconds || 0),
    max_reward: Number(row.max_reward || 0),
    claimed_amount: Number(row.claimed_amount || 0),
  };
}
