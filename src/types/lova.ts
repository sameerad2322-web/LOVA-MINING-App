export type UserStatus = 'active' | 'suspended' | 'banned';
export type SessionStatus = 'active' | 'stopped' | 'expired' | 'claimed';
export type WithdrawalStatus = 'Pending' | 'Approved' | 'Rejected' | 'Paid';
export type LevelUpgradeStatus = 'Pending' | 'Approved' | 'Rejected';
export type AdminRole = 'super_admin' | 'finance_admin' | 'moderator';
export type TaskCategory =
  | 'telegram_channel'
  | 'social_link'
  | 'referral_milestone'
  | 'wallet_verified'
  | 'mining_sessions'
  | 'ads_code'
  | 'custom';

export interface LovaUser {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  referral_code: string;
  referred_by_user_id: string | null;
  available_balance: number;
  pending_balance: number;
  total_earned: number;
  total_withdrawn: number;
  streak_days: number;
  last_checkin_date: string | null;
  membership_level: number;
  membership_updated_at?: string | null;
  status: UserStatus;
  ban_reason: string | null;
  last_active_at: string;
  created_at: string;
}

export interface MembershipLevel {
  level_number: number;
  name: string;
  badge_label: string;
  required_lova_amount: number;
  mining_multiplier: number;
  daily_bonus_multiplier: number;
  benefits: string[];
  is_active: boolean;
}

export interface LevelUpgradeRequest {
  id: string;
  user_id: string;
  from_level: number;
  target_level: number;
  target_level_name?: string;
  required_lova_amount: number;
  admin_wallet_address: string;
  sender_wallet_address: string | null;
  tx_hash: string;
  status: LevelUpgradeStatus;
  admin_note: string | null;
  reviewed_by_admin_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at?: string;
  user_handle?: string;
  telegram_id?: number;
}

export interface UserWallet {
  id: string;
  user_id: string;
  wallet_address: string;
  raw_address: string;
  wallet_provider: string | null;
  is_active: boolean;
  is_verified: boolean;
  is_suspended: boolean;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WalletVerification {
  id: string;
  user_id: string;
  wallet_id: string | null;
  tx_hash: string;
  sender_address: string;
  recipient_address: string;
  jetton_master_address: string;
  amount_raw: string;
  amount_display: number;
  decimals: number;
  status: 'pending' | 'verified' | 'rejected';
  verified_at: string;
  created_at: string;
}

export interface OnChainWalletBalances {
  tonBalance: string;
  lovaBalance: string | null;
  lovaJettonWallet: string | null;
  gramBalance: string | null;
  gramJettonWallet: string | null;
}

export interface MiningSession {
  id: string;
  user_id: string;
  reward_rate_per_sec: number;
  duration_seconds: number;
  max_reward: number;
  started_at: string;
  ends_at: string;
  stopped_at: string | null;
  claimed_at: string | null;
  claimed_amount: number;
  status: SessionStatus;
}

export interface MiningReward {
  id: string;
  user_id: string;
  session_id: string | null;
  reward_type: 'session_claim' | 'daily_bonus' | 'streak_bonus';
  amount: number;
  is_demo_balance: boolean;
  created_at: string;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  category: TaskCategory;
  reward_amount: number;
  action_url: string | null;
  telegram_chat_id: string | null;
  required_count: number;
  verification_code: string | null;
  requires_code?: boolean;
  is_active: boolean;
  sort_order: number;
  user_status?: 'not_started' | 'started' | 'completed';
  started_at?: string | null;
  completed_at?: string | null;
}

export interface WithdrawalItem {
  id: string;
  user_id: string;
  destination_address: string;
  amount: number;
  is_demo_request: boolean;
  status: WithdrawalStatus;
  payout_tx_hash: string | null;
  admin_note: string | null;
  reviewed_at: string | null;
  paid_at: string | null;
  created_at: string;
  user_handle?: string;
  telegram_id?: number;
}

export interface TransactionItem {
  id: string;
  user_id: string;
  tx_type:
    | 'mining_claim'
    | 'daily_checkin'
    | 'task_reward'
    | 'referral_bonus'
    | 'withdrawal_request'
    | 'withdrawal_paid'
    | 'withdrawal_refund'
    | 'gram_verification';
  amount: number;
  currency: string;
  chain_tx_hash: string | null;
  description: string;
  is_demo: boolean;
  created_at: string;
}

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  category: 'airdrop' | 'update' | 'maintenance' | 'security';
  is_active: boolean;
  created_at: string;
}

export interface AppSettings {
  app_name: string;
  mining_enabled: boolean;
  emergency_pause: boolean;
  maintenance_mode: boolean;
  reward_rate_per_hour: number;
  mining_duration_seconds: number;
  min_claim_amount: number;
  max_reward_per_session: number;
  daily_bonus_amount: number;
  referral_l1_fixed_bonus: number;
  referral_l1_percent: number;
  referral_l2_percent: number;
  min_withdrawal: number;
  max_withdrawal: number;
  gram_verification_fee: number;
  admin_ton_wallet_override: string | null;
  admin_lova_wallet_address?: string | null;
  lova_jetton_master_address?: string | null;
  lova_jetton_decimals?: number;
  gram_jetton_master_address?: string | null;
  gram_jetton_decimals?: number;
  updated_at: string;
}

export interface PublicSystemStatus {
  databaseMode: 'd1' | 'd1_needs_schema' | 'd1_not_bound' | 'local_sqlite';
  telegramAuthMode: 'hmac_strict' | 'preview_fallback';
  telegramBotConfigured: boolean;
  telegramBotUsername: string | null;
  isDemoTokenMode: boolean;
  isLiveTokenMode?: boolean;
  lovaJettonMasterAddress: string | null;
  lovaJettonDecimals?: number;
  gramVerificationConfigured: boolean;
  gramVerificationFee: number;
  gramJettonMasterAddress: string | null;
  gramJettonDecimals: number | null;
  adminTonWalletAddress: string | null;
  adminLovaWalletAddress?: string | null;
  tonApiConfigured: boolean;
  adminBootstrapConfigured: boolean;
  publicAppUrl?: string | null;
}

export interface AuthBootstrapPayload {
  user: LovaUser;
  activeSession: MiningSession | null;
  activeWallet: UserWallet | null;
  settings: AppSettings;
  announcements: AnnouncementItem[];
  systemStatus: PublicSystemStatus;
  membershipLevels?: MembershipLevel[];
  currentMembership?: MembershipLevel;
  serverTime: string;
  canCheckInToday: boolean;
}
