import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Address } from '@ton/core';
import { SUPABASE_SCHEMA_SQL } from './schemaSql.ts';
import type {
  AdminRole,
  AnnouncementItem,
  AppSettings,
  LevelUpgradeRequest,
  LovaUser,
  MembershipLevel,
  MiningReward,
  MiningSession,
  OnChainWalletBalances,
  PublicSystemStatus,
  TaskItem,
  TransactionItem,
  UserStatus,
  UserWallet,
  WalletVerification,
  WithdrawalItem,
} from '../src/types/lova.ts';

export interface EdgeEnv {
  APP_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_ALLOW_DEV_PREVIEW?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SESSION_SECRET?: string;
  ADMIN_BOOTSTRAP_SECRET?: string;
  ADMIN_TELEGRAM_IDS?: string;
  GRAM_JETTON_MASTER_ADDRESS?: string;
  GRAM_JETTON_DECIMALS?: string;
  ADMIN_TON_WALLET_ADDRESS?: string;
  ADMIN_LOVA_WALLET_ADDRESS?: string;
  TON_API_ENDPOINT?: string;
  TON_API_KEY?: string;
  LOVA_JETTON_MASTER_ADDRESS?: string;
  LOVA_JETTON_DECIMALS?: string;
}

interface ParsedConfig {
  appUrl: string;
  telegramBotToken: string;
  telegramBotUsername: string | null;
  telegramWebhookSecret: string | null;
  telegramAllowDevPreview: boolean;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  sessionSecret: string;
  explicitSessionSecret: string | null;
  adminBootstrapSecret: string;
  adminTelegramIds: number[];
  gramJettonMasterAddress: string | null;
  gramJettonDecimals: number;
  adminTonWalletAddress: string | null;
  adminLovaWalletAddress: string | null;
  tonApiEndpoint: string;
  tonApiKey: string | null;
  lovaJettonMasterAddress: string | null;
  lovaJettonDecimals: number;
}

interface SessionClaims {
  sub: string;
  tgId: number;
  kind: 'user' | 'admin';
  adminId?: string;
  adminRole?: AdminRole;
  exp: number;
}

const SESSION_COOKIE = 'lova_session';
const ADMIN_COOKIE = 'lova_admin_session';

const DEFAULT_SETTINGS: AppSettings = {
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

const DEFAULT_MEMBERSHIP_LEVELS: MembershipLevel[] = [
  {
    level_number: 1,
    name: 'Starter Miner',
    badge_label: 'LVL 1',
    required_lova_amount: 0,
    mining_multiplier: 1.0,
    daily_bonus_multiplier: 1.0,
    benefits: [
      'Standard 1.0x LOVA mining speed',
      'Standard daily check-in streak rewards',
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
    daily_bonus_multiplier: 1.15,
    benefits: [
      '1.25x LOVA mining speed boost (+25%)',
      '1.15x daily check-in bonus rewards',
      'Bronze Rig verified member badge',
    ],
    is_active: true,
  },
  {
    level_number: 3,
    name: 'Silver Cluster',
    badge_label: 'LVL 3',
    required_lova_amount: 2000,
    mining_multiplier: 1.6,
    daily_bonus_multiplier: 1.35,
    benefits: [
      '1.60x LOVA mining speed boost (+60%)',
      '1.35x daily check-in bonus rewards',
      'Silver Cluster priority payout queue',
    ],
    is_active: true,
  },
  {
    level_number: 4,
    name: 'Gold Validator',
    badge_label: 'LVL 4',
    required_lova_amount: 5000,
    mining_multiplier: 2.1,
    daily_bonus_multiplier: 1.6,
    benefits: [
      '2.10x LOVA mining speed boost (+110%)',
      '1.60x daily check-in bonus rewards',
      'Gold Validator higher session cap & VIP badge',
    ],
    is_active: true,
  },
  {
    level_number: 5,
    name: 'Diamond Sovereign',
    badge_label: 'LVL 5',
    required_lova_amount: 15000,
    mining_multiplier: 3.0,
    daily_bonus_multiplier: 2.0,
    benefits: [
      '3.00x LOVA mining speed boost (+200%)',
      '2.00x daily check-in bonus rewards',
      'Top-tier Sovereign priority TON settlement',
    ],
    is_active: true,
  },
];

function normalizeBotToken(raw: string): string {
  return raw
    .trim()
    .replace(/^TELEGRAM_BOT_TOKEN\s*=\s*/i, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
    .replace(/^bot(?=\d+:)/i, '');
}

function parseEnv(env: EdgeEnv, requestUrl: URL): ParsedConfig {
  const botToken = normalizeBotToken(env.TELEGRAM_BOT_TOKEN || '');
  const explicitSession = (env.SESSION_SECRET || '').trim() || null;
  const derivedFallback = crypto
    .createHmac('sha256', env.SUPABASE_SERVICE_ROLE_KEY || botToken || 'lova-edge-fallback')
    .update('lova-edge-session-v1')
    .digest('hex');

  return {
    appUrl: (env.APP_URL || requestUrl.origin).trim().replace(/\/+$/, ''),
    telegramBotToken: botToken,
    telegramBotUsername: (env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@+/, '') || null,
    telegramWebhookSecret: (env.TELEGRAM_WEBHOOK_SECRET || '').trim() || null,
    telegramAllowDevPreview: env.TELEGRAM_ALLOW_DEV_PREVIEW === 'true',
    supabaseUrl: (env.SUPABASE_URL || '').trim(),
    supabaseServiceRoleKey: (env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
    explicitSessionSecret: explicitSession,
    sessionSecret: explicitSession || derivedFallback,
    adminBootstrapSecret: (env.ADMIN_BOOTSTRAP_SECRET || '').trim(),
    adminTelegramIds: (env.ADMIN_TELEGRAM_IDS || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0),
    gramJettonMasterAddress: (env.GRAM_JETTON_MASTER_ADDRESS || '').trim() || null,
    gramJettonDecimals: env.GRAM_JETTON_DECIMALS ? Number(env.GRAM_JETTON_DECIMALS) : 9,
    adminTonWalletAddress: (env.ADMIN_TON_WALLET_ADDRESS || '').trim() || null,
    adminLovaWalletAddress: (env.ADMIN_LOVA_WALLET_ADDRESS || '').trim() || null,
    tonApiEndpoint: (env.TON_API_ENDPOINT || 'https://tonapi.io/v2').trim().replace(/\/+$/, ''),
    tonApiKey: (env.TON_API_KEY || '').trim() || null,
    lovaJettonMasterAddress: (env.LOVA_JETTON_MASTER_ADDRESS || '').trim() || null,
    lovaJettonDecimals: env.LOVA_JETTON_DECIMALS ? Number(env.LOVA_JETTON_DECIMALS) : 9,
  };
}

function jsonResponse(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { status, headers });
}

function buildCookieHeader(name: string, value: string, maxAgeSec: number, isHttps: boolean): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', `Max-Age=${maxAgeSec}`];
  if (isHttps) {
    parts.push('SameSite=None', 'Secure');
  } else {
    parts.push('SameSite=Lax');
  }
  return parts.join('; ');
}

function extractBearerOrCookie(req: Request, cookieName: string, headerName = 'authorization'): string | null {
  const headerVal = req.headers.get(headerName);
  if (headerVal && headerVal.startsWith('Bearer ')) {
    return headerVal.slice(7).trim();
  }
  const cookieHeader = req.headers.get('cookie');
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const trimmed = part.trim();
      const idx = trimmed.indexOf('=');
      if (idx > 0 && trimmed.slice(0, idx) === cookieName) {
        return decodeURIComponent(trimmed.slice(idx + 1));
      }
    }
  }
  return null;
}

function signSessionToken(
  claims: Omit<SessionClaims, 'exp'>,
  sessionSecret: string,
  ttlSeconds = 60 * 60 * 24 * 7
): string {
  const payload: SessionClaims = {
    ...claims,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySessionToken(token: string | null | undefined, sessionSecret: string): SessionClaims | null {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionClaims;
    if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

function verifyTelegramInitData(initDataRaw: string, botToken: string) {
  if (!initDataRaw || !botToken) return null;
  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash) return null;

  const authDate = Number(params.get('auth_date') || '0');
  const nowSec = Math.floor(Date.now() / 1000);
  if (!authDate || nowSec - authDate > 86400) return null;

  const entries: string[] = [];
  params.forEach((value, key) => {
    if (key !== 'hash') entries.push(`${key}=${value}`);
  });
  entries.sort();

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(entries.join('\n')).digest('hex');

  const hashBuf = Buffer.from(hash, 'hex');
  const computedBuf = Buffer.from(computedHash, 'hex');
  if (hashBuf.length !== computedBuf.length || !crypto.timingSafeEqual(hashBuf, computedBuf)) return null;

  const userJson = params.get('user');
  if (!userJson) return null;
  try {
    const parsedUser = JSON.parse(userJson) as {
      id: number;
      username?: string;
      first_name?: string;
      last_name?: string;
      photo_url?: string;
    };
    if (!parsedUser || typeof parsedUser.id !== 'number') return null;
    return { user: parsedUser, startParam: params.get('start_param'), authDate };
  } catch {
    return null;
  }
}

function safeText(val: unknown, maxLen = 200): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function normalizeTonAddress(input: string): { friendly: string; raw: string } | null {
  try {
    const addr = Address.parse(input.trim());
    return {
      friendly: addr.toString({ bounceable: false, urlSafe: true }),
      raw: addr.toRawString(),
    };
  } catch {
    return null;
  }
}

function normalizeRaw(addr: string | undefined | null): string | null {
  if (!addr) return null;
  try {
    return Address.parse(addr.trim()).toRawString();
  } catch {
    return null;
  }
}

function normalizeFriendly(addr: string | undefined | null): string | null {
  if (!addr) return null;
  try {
    return Address.parse(addr.trim()).toString({ bounceable: true, urlSafe: true });
  } catch {
    return null;
  }
}

function toBaseUnits(amountDisplay: number, decimals: number): bigint {
  const fixed = amountDisplay.toFixed(decimals);
  const [whole, frac = ''] = fixed.split('.');
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

function formatBaseUnits(raw: string, decimals: number): string {
  try {
    const val = BigInt(raw);
    const divisor = 10n ** BigInt(decimals);
    const whole = val / divisor;
    const rem = val % divisor;
    if (rem === 0n) return whole.toString();
    const frac = rem.toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '');
    return frac ? `${whole.toString()}.${frac}` : whole.toString();
  } catch {
    return '0';
  }
}

function resolveTonConfig(cfg: ParsedConfig, settings?: Partial<AppSettings> | null) {
  const adminWallet = (settings?.admin_ton_wallet_override || cfg.adminTonWalletAddress || '').trim() || null;
  const adminLovaWallet =
    (
      settings?.admin_lova_wallet_address ||
      cfg.adminLovaWalletAddress ||
      settings?.admin_ton_wallet_override ||
      cfg.adminTonWalletAddress ||
      ''
    ).trim() || null;
  const gramMaster = (settings?.gram_jetton_master_address || cfg.gramJettonMasterAddress || '').trim() || null;
  const gramDecimals =
    settings?.gram_jetton_decimals !== undefined && settings?.gram_jetton_decimals !== null
      ? Number(settings.gram_jetton_decimals)
      : cfg.gramJettonDecimals;
  const lovaMaster = (settings?.lova_jetton_master_address || cfg.lovaJettonMasterAddress || '').trim() || null;
  const lovaDecimals =
    settings?.lova_jetton_decimals !== undefined && settings?.lova_jetton_decimals !== null
      ? Number(settings.lova_jetton_decimals)
      : cfg.lovaJettonDecimals;
  return { adminWallet, adminLovaWallet, gramMaster, gramDecimals, lovaMaster, lovaDecimals };
}

function buildSystemStatus(
  cfg: ParsedConfig,
  schemaReady: boolean,
  settings?: Partial<AppSettings> | null
): PublicSystemStatus {
  const ton = resolveTonConfig(cfg, settings);
  const dbMode: PublicSystemStatus['databaseMode'] = !cfg.supabaseUrl || !cfg.supabaseServiceRoleKey
    ? 'local_preview'
    : schemaReady
      ? 'supabase'
      : 'supabase_needs_schema';

  return {
    databaseMode: dbMode,
    telegramAuthMode: cfg.telegramBotToken ? 'hmac_strict' : 'preview_fallback',
    telegramBotConfigured: Boolean(cfg.telegramBotToken),
    telegramBotUsername: cfg.telegramBotUsername,
    isDemoTokenMode: false,
    isLiveTokenMode: true,
    lovaJettonMasterAddress: ton.lovaMaster,
    lovaJettonDecimals: ton.lovaDecimals,
    gramVerificationConfigured: Boolean(
      ton.gramMaster && Number.isInteger(ton.gramDecimals) && ton.adminWallet
    ),
    gramVerificationFee: Number(settings?.gram_verification_fee ?? 0.05),
    gramJettonMasterAddress: ton.gramMaster,
    gramJettonDecimals: ton.gramDecimals,
    adminTonWalletAddress: ton.adminWallet,
    adminLovaWalletAddress: ton.adminLovaWallet,
    tonApiConfigured: Boolean(cfg.tonApiEndpoint),
    adminBootstrapConfigured: Boolean(cfg.adminBootstrapSecret || cfg.adminTelegramIds.length > 0),
  };
}

function maskDisplayName(user: { username?: string | null; first_name?: string | null; telegram_id: number }) {
  if (user.username) {
    const u = user.username;
    if (u.length <= 4) return `@${u[0]}***`;
    return `@${u.slice(0, 3)}***${u.slice(-2)}`;
  }
  if (user.first_name) return `${user.first_name.slice(0, 2)}***`;
  return `Miner #${String(user.telegram_id).slice(-4)}`;
}

function normalizeUser(row: Record<string, unknown>): LovaUser {
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

function normalizeSession(row: Record<string, unknown>): MiningSession {
  return {
    ...(row as unknown as MiningSession),
    reward_rate_per_sec: Number(row.reward_rate_per_sec || 0),
    duration_seconds: Number(row.duration_seconds || 0),
    max_reward: Number(row.max_reward || 0),
    claimed_amount: Number(row.claimed_amount || 0),
  };
}

function getWebhookSecret(cfg: ParsedConfig): string {
  if (cfg.telegramWebhookSecret) return cfg.telegramWebhookSecret;
  const seed = cfg.explicitSessionSecret || cfg.telegramBotToken || 'lova-fallback-seed';
  return crypto.createHmac('sha256', seed).update('lova-telegram-webhook-v1').digest('hex').slice(0, 48);
}

async function callTelegramApi<T>(cfg: ParsedConfig, method: string, payload?: Record<string, unknown>) {
  if (!cfg.telegramBotToken) {
    return { ok: false as const, description: 'TELEGRAM_BOT_TOKEN is not configured.' };
  }
  const res = await fetch(`https://api.telegram.org/bot${cfg.telegramBotToken}/${method}`, {
    method: payload ? 'POST' : 'GET',
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  return (await res.json().catch(() => ({
    ok: false,
    description: `Invalid JSON response (${res.status})`,
  }))) as { ok: boolean; result?: T; description?: string };
}

export function handleTonManifestRequest(request: Request): Response {
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  return jsonResponse({
    url: origin,
    name: 'LOVA Mining',
    iconUrl: `${origin}/src/assets/images/lova_emblem_1794836082450.jpg`,
  });
}

export async function handleApiRequest(request: Request, env: EdgeEnv): Promise<Response> {
  const url = new URL(request.url);
  const cfg = parseEnv(env, url);
  const isHttps = url.protocol === 'https:';
  const apiPath = url.pathname.replace(/^\/api/, '') || '/';
  const method = request.method.toUpperCase();

  if (apiPath === '/health' && method === 'GET') {
    return jsonResponse({
      ok: true,
      service: 'lova-mining-edge-api',
      runtime: 'cloudflare',
      timestamp: new Date().toISOString(),
    });
  }

  if (!cfg.supabaseUrl || !cfg.supabaseServiceRoleKey) {
    if (apiPath === '/system/public' && method === 'GET') {
      return jsonResponse({
        systemStatus: buildSystemStatus(cfg, false, null),
        botUsername: cfg.telegramBotUsername,
        appName: 'LOVA Mining',
      });
    }
    return jsonResponse(
      {
        error: 'SUPABASE_NOT_CONFIGURED',
        message:
          'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Cloudflare Pages/Workers Environment Variables and run supabase/schema.sql.',
      },
      503
    );
  }

  const sb: SupabaseClient = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Probe schema readiness once per request group cleanly
  const getSettings = async (): Promise<{ settings: AppSettings; schemaReady: boolean }> => {
    const { data, error } = await sb.from('app_settings').select('*').eq('id', 1).single();
    if (error || !data) {
      const userCheck = await sb.from('users').select('id').limit(1);
      return { settings: { ...DEFAULT_SETTINGS }, schemaReady: !userCheck.error };
    }
    return {
      schemaReady: true,
      settings: {
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
      },
    };
  };

  const getBotUsername = async (): Promise<string | null> => {
    if (cfg.telegramBotUsername) return cfg.telegramBotUsername;
    if (!cfg.telegramBotToken) return null;
    const me = await callTelegramApi<{ username?: string }>(cfg, 'getMe').catch(() => null);
    return me?.ok && me.result?.username ? me.result.username.replace(/^@+/, '') : null;
  };

  const readJson = async <T = Record<string, unknown>>(): Promise<T> => {
    return (await request.json().catch(() => ({}))) as T;
  };

  // Public System Status
  if (apiPath === '/system/public' && method === 'GET') {
    const [{ settings, schemaReady }, botUsername] = await Promise.all([
      getSettings(),
      getBotUsername(),
    ]);
    const status = buildSystemStatus(cfg, schemaReady, settings);
    return jsonResponse({
      systemStatus: { ...status, telegramBotUsername: botUsername || status.telegramBotUsername },
      botUsername: botUsername || status.telegramBotUsername,
      appName: settings.app_name,
    });
  }

  // Telegram Webhook
  if (apiPath === '/telegram/webhook' && method === 'GET') {
    const [me, wh] = cfg.telegramBotToken
      ? await Promise.all([
          callTelegramApi<{ id: number; username?: string }>(cfg, 'getMe'),
          callTelegramApi<{ url: string; pending_update_count: number; last_error_message?: string }>(
            cfg,
            'getWebhookInfo'
          ),
        ])
      : [null, null];
    return jsonResponse({
      ok: true,
      method: 'POST',
      endpoint: '/api/telegram/webhook',
      botConfigured: Boolean(cfg.telegramBotToken),
      botTokenValid: Boolean(me?.ok && me.result),
      botId: me?.result?.id || null,
      botUsername: me?.result?.username || null,
      webhookConfigured: Boolean(wh?.result?.url),
      pendingUpdateCount: wh?.result?.pending_update_count ?? 0,
      lastWebhookError: wh?.result?.last_error_message || null,
    });
  }

  if (apiPath === '/telegram/webhook' && method === 'POST') {
    const provided = request.headers.get('x-telegram-bot-api-secret-token') || '';
    const expected = getWebhookSecret(cfg);
    if (cfg.telegramWebhookSecret || provided.length > 0) {
      const a = Buffer.from(provided);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return jsonResponse({ ok: false, error: 'INVALID_WEBHOOK_SECRET' }, 403);
      }
    }
    if (!cfg.telegramBotToken) {
      return jsonResponse({ ok: false, skipped: 'TELEGRAM_BOT_NOT_CONFIGURED' });
    }
    const update = await readJson<{
      callback_query?: { id: string };
      message?: {
        from?: { id: number; first_name?: string };
        chat?: { id: number; type: string };
        text?: string;
      };
    }>();
    if (update.callback_query?.id) {
      await callTelegramApi(cfg, 'answerCallbackQuery', {
        callback_query_id: update.callback_query.id,
      }).catch(() => undefined);
    }
    const msg = update.message;
    if (msg?.text && msg.chat?.id) {
      const [rawCmd, rawArg] = msg.text.trim().split(/\s+/, 2);
      const cmd = rawCmd.split('@')[0].toLowerCase();
      const sendMsg = (text: string, webAppUrl: string, btn = '🚀 Open LOVA Mining') =>
        callTelegramApi(cfg, 'sendMessage', {
          chat_id: msg.chat!.id,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...(webAppUrl.startsWith('https://')
            ? { reply_markup: { inline_keyboard: [[{ text: btn, web_app: { url: webAppUrl } }]] } }
            : {}),
        }).catch(() => undefined);

      if (cmd === '/start') {
        const arg = (rawArg || '').trim();
        const launch = arg
          ? `${cfg.appUrl}/?tgWebAppStartParam=${encodeURIComponent(arg)}`
          : cfg.appUrl;
        const firstName = msg.from?.first_name ? `, ${msg.from.first_name}` : '';
        await sendMsg(
          `<b>Welcome to LOVA Mining${firstName}!</b>\nMine Today, Earn Tomorrow.\n\nTap below to launch LOVA Mining, earn LOVA on TON, and complete 0.05 GRAM KYC verification.`,
          launch,
          '🚀 Launch LOVA Mining'
        );
      } else if (cmd === '/balance') {
        const tgId = msg.from?.id;
        const { data: u } = tgId
          ? await sb.from('users').select('*').eq('telegram_id', tgId).maybeSingle()
          : { data: null };
        if (u) {
          await sendMsg(
            `<b>Your Live LOVA Account (TON Network)</b>\nAvailable: <code>${Number(
              u.available_balance
            ).toFixed(4)} LOVA</code>\nPending: <code>${Number(u.pending_balance).toFixed(
              2
            )} LOVA</code>\nTotal Earned: <code>${Number(u.total_earned).toFixed(4)} LOVA</code>`,
            cfg.appUrl,
            '💼 Open Wallet & Mining'
          );
        } else {
          await sendMsg('Open the LOVA Mini App to initialize your miner profile.', cfg.appUrl);
        }
      } else if (cmd === '/referral') {
        const tgId = msg.from?.id;
        const { data: u } = tgId
          ? await sb.from('users').select('referral_code').eq('telegram_id', tgId).maybeSingle()
          : { data: null };
        const botName = await getBotUsername();
        const refLink = u
          ? botName
            ? `https://t.me/${botName}?startapp=ref_${u.referral_code}`
            : `${cfg.appUrl}/?ref=${u.referral_code}`
          : cfg.appUrl;
        await sendMsg(`<b>Your LOVA Referral Link</b>\n<code>${refLink}</code>`, cfg.appUrl, '👥 Invite Friends');
      } else {
        await sendMsg(
          `<b>LOVA Mining</b> — Mine Today, Earn Tomorrow.\nCommands: /start, /mine, /balance, /referral, /help`,
          cfg.appUrl
        );
      }
    }
    return jsonResponse({ ok: true });
  }

  // Helper: Auth
  const getAuthedUser = async (): Promise<{ user: LovaUser; claims: SessionClaims } | Response> => {
    const token = extractBearerOrCookie(request, SESSION_COOKIE, 'authorization');
    const claims = verifySessionToken(token, cfg.sessionSecret);
    if (!claims || claims.kind !== 'user') {
      return jsonResponse({ error: 'UNAUTHORIZED', message: 'Valid session required.' }, 401);
    }
    const { data } = await sb.from('users').select('*').eq('id', claims.sub).maybeSingle();
    if (!data) return jsonResponse({ error: 'USER_NOT_FOUND', message: 'User account not found.' }, 401);
    const user = normalizeUser(data);
    if (user.status === 'banned') {
      return jsonResponse(
        { error: 'ACCOUNT_BANNED', message: user.ban_reason || 'Account banned by administrator.' },
        403
      );
    }
    return { user, claims };
  };

  const getAuthedAdmin = (): SessionClaims | Response => {
    const token = extractBearerOrCookie(request, ADMIN_COOKIE, 'x-admin-authorization');
    const claims = verifySessionToken(token, cfg.sessionSecret);
    if (!claims || claims.kind !== 'admin' || !claims.adminRole) {
      return jsonResponse({ error: 'ADMIN_UNAUTHORIZED', message: 'Admin authentication required.' }, 401);
    }
    return claims;
  };

  const getMembershipLevels = async (includeInactive = false): Promise<MembershipLevel[]> => {
    let q = sb.from('membership_levels').select('*').order('level_number', { ascending: true });
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error || !data || data.length === 0) {
      return DEFAULT_MEMBERSHIP_LEVELS.filter((l) => includeInactive || l.is_active);
    }
    return data.map(normalizeMembershipLevelRow);
  };

  const getMembershipLevelByNumber = async (levelNumber: number): Promise<MembershipLevel> => {
    const levels = await getMembershipLevels(true);
    return (
      levels.find((l) => l.level_number === levelNumber) ||
      levels[0] ||
      DEFAULT_MEMBERSHIP_LEVELS[0]
    );
  };

  const buildBootstrap = async (user: LovaUser) => {
    const [{ settings, schemaReady }, activeSessionRes, activeWalletRes, annRes, botName, membershipLevels] =
      await Promise.all([
        getSettings(),
        sb
          .from('mining_sessions')
          .select('*')
          .eq('user_id', user.id)
          .in('status', ['active', 'expired'])
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb
          .from('user_wallets')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle(),
        sb.from('announcements').select('*').eq('is_active', true).order('created_at', { ascending: false }),
        getBotUsername(),
        getMembershipLevels(false),
      ]);

    let activeSession = activeSessionRes.data ? normalizeSession(activeSessionRes.data) : null;
    if (activeSession && activeSession.status === 'active' && Date.now() >= new Date(activeSession.ends_at).getTime()) {
      await sb.from('mining_sessions').update({ status: 'expired' }).eq('id', activeSession.id);
      activeSession.status = 'expired';
    }

    const status = buildSystemStatus(cfg, schemaReady, settings);
    if (botName) status.telegramBotUsername = botName;
    const todayUtc = new Date().toISOString().slice(0, 10);
    const currentLevelNum = user.membership_level || 1;
    const currentMembership =
      membershipLevels.find((l) => l.level_number === currentLevelNum) || membershipLevels[0];

    return {
      user,
      activeSession,
      activeWallet: (activeWalletRes.data as UserWallet) || null,
      settings,
      announcements: (annRes.data || []) as AnnouncementItem[],
      systemStatus: status,
      membershipLevels,
      currentMembership,
      serverTime: new Date().toISOString(),
      canCheckInToday: user.last_checkin_date !== todayUtc,
    };
  };

  const creditUser = async (
    userId: string,
    amount: number,
    txType: TransactionItem['tx_type'],
    description: string,
    chainTxHash: string | null = null
  ): Promise<LovaUser> => {
    const clean = Number(amount.toFixed(6));
    const { data: curr } = await sb.from('users').select('*').eq('id', userId).single();
    if (!curr) throw new Error('User not found');
    const u = normalizeUser(curr);
    const { data: updated, error } = await sb
      .from('users')
      .update({
        available_balance: Number((u.available_balance + clean).toFixed(6)),
        total_earned: Number((u.total_earned + clean).toFixed(6)),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    await sb.from('transactions').insert({
      user_id: userId,
      tx_type: txType,
      amount: clean,
      currency: 'LOVA',
      chain_tx_hash: chainTxHash,
      description,
      is_demo: false,
    });
    return normalizeUser(updated);
  };

  // AUTH ROUTES
  if (apiPath === '/auth/telegram' && method === 'POST') {
    const body = await readJson<{ initData?: string; startParam?: string; previewSlot?: string }>();
    const initData = typeof body.initData === 'string' ? body.initData : '';
    const refParam = safeText(body.startParam, 64) || null;
    let tgUser: { id: number; username?: string; first_name?: string; last_name?: string; photo_url?: string } | null = null;
    let startParam = refParam;

    if (initData && cfg.telegramBotToken) {
      const verified = verifyTelegramInitData(initData, cfg.telegramBotToken);
      if (!verified) {
        return jsonResponse(
          { error: 'INVALID_INIT_DATA', message: 'Telegram WebApp initData signature verification failed.' },
          401
        );
      }
      tgUser = verified.user;
      startParam = verified.startParam || refParam;
    } else if (cfg.telegramAllowDevPreview) {
      const existingToken = extractBearerOrCookie(request, SESSION_COOKIE, 'authorization');
      const claims = verifySessionToken(existingToken, cfg.sessionSecret);
      if (claims && claims.kind === 'user') {
        const { data: eu } = await sb.from('users').select('*').eq('id', claims.sub).maybeSingle();
        if (eu) {
          tgUser = {
            id: eu.telegram_id,
            username: eu.username || 'lova_preview_miner',
            first_name: eu.first_name || 'Preview',
            last_name: eu.last_name || 'Miner',
          };
        }
      }
      if (!tgUser) {
        tgUser = { id: 900100001, username: 'lova_preview_miner', first_name: 'LOVA', last_name: 'Miner' };
      }
    } else {
      return jsonResponse(
        {
          error: 'TELEGRAM_AUTH_REQUIRED',
          message: 'Please open LOVA Mining inside Telegram to authenticate securely.',
        },
        401
      );
    }

    const now = new Date().toISOString();
    const { data: existing } = await sb
      .from('users')
      .select('*')
      .eq('telegram_id', tgUser.id)
      .maybeSingle();

    let user: LovaUser;
    if (existing) {
      const { data: updated, error } = await sb
        .from('users')
        .update({
          username: tgUser.username ?? existing.username,
          first_name: tgUser.first_name ?? existing.first_name,
          last_name: tgUser.last_name ?? existing.last_name,
          photo_url: tgUser.photo_url ?? existing.photo_url,
          last_active_at: now,
          updated_at: now,
        })
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) return jsonResponse({ error: 'AUTH_DB_ERROR', message: error.message }, 500);
      user = normalizeUser(updated);
    } else {
      let referrer: LovaUser | null = null;
      if (startParam) {
        const cleanCode = startParam.trim().replace(/^ref_/i, '');
        if (cleanCode) {
          const { data: cand } = await sb
            .from('users')
            .select('*')
            .eq('referral_code', cleanCode)
            .maybeSingle();
          if (cand && cand.telegram_id !== tgUser.id && cand.status === 'active') {
            referrer = normalizeUser(cand);
          }
        }
      }
      const refHash = crypto
        .createHash('sha256')
        .update(`${tgUser.id}:${crypto.randomBytes(4).toString('hex')}`)
        .digest('hex');
      const referral_code = `LOVA${refHash.slice(0, 8).toUpperCase()}`;

      const { data: inserted, error } = await sb
        .from('users')
        .insert({
          telegram_id: tgUser.id,
          username: tgUser.username || null,
          first_name: tgUser.first_name || null,
          last_name: tgUser.last_name || null,
          photo_url: tgUser.photo_url || null,
          referral_code,
          referred_by_user_id: referrer ? referrer.id : null,
          last_active_at: now,
        })
        .select('*')
        .single();
      if (error) return jsonResponse({ error: 'AUTH_INSERT_ERROR', message: error.message }, 500);
      user = normalizeUser(inserted);

      if (referrer) {
        const { settings } = await getSettings();
        await sb
          .from('referrals')
          .upsert(
            { referrer_user_id: referrer.id, referred_user_id: user.id, level: 1 },
            { onConflict: 'referred_user_id,level', ignoreDuplicates: true }
          );
        if (settings.referral_l1_fixed_bonus > 0) {
          await creditUser(
            referrer.id,
            settings.referral_l1_fixed_bonus,
            'referral_bonus',
            'Level 1 referral signup bonus'
          );
          await sb.from('referral_rewards').insert({
            referrer_user_id: referrer.id,
            referred_user_id: user.id,
            level: 1,
            reward_source: 'signup_fixed',
            amount: settings.referral_l1_fixed_bonus,
            source_session_id: null,
          });
        }
        if (referrer.referred_by_user_id && referrer.referred_by_user_id !== user.id) {
          await sb
            .from('referrals')
            .upsert(
              { referrer_user_id: referrer.referred_by_user_id, referred_user_id: user.id, level: 2 },
              { onConflict: 'referred_user_id,level', ignoreDuplicates: true }
            );
        }
      }
    }

    if (user.status === 'banned') {
      return jsonResponse({ error: 'ACCOUNT_BANNED', message: user.ban_reason || 'Account banned.' }, 403);
    }

    const token = signSessionToken({ sub: user.id, tgId: user.telegram_id, kind: 'user' }, cfg.sessionSecret);
    const payload = await buildBootstrap(user);
    return jsonResponse({ sessionToken: token, ...payload }, 200, {
      'Set-Cookie': buildCookieHeader(SESSION_COOKIE, token, 60 * 60 * 24 * 7, isHttps),
    });
  }

  if (apiPath === '/auth/me' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    return jsonResponse(await buildBootstrap(auth.user));
  }

  if (apiPath === '/auth/logout' && method === 'POST') {
    return jsonResponse(
      { ok: true },
      200,
      { 'Set-Cookie': buildCookieHeader(SESSION_COOKIE, '', 0, isHttps) }
    );
  }

  // MINING ROUTES
  if (apiPath === '/mining/start' && method === 'POST') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    if (auth.user.status !== 'active') {
      return jsonResponse({ error: 'ACCOUNT_SUSPENDED', message: 'Your account is suspended.' }, 403);
    }
    const { settings } = await getSettings();
    if (settings.maintenance_mode || settings.emergency_pause || !settings.mining_enabled) {
      return jsonResponse({ error: 'MINING_PAUSED', message: 'Mining is currently paused by administrators.' }, 403);
    }
    const { data: existing } = await sb
      .from('mining_sessions')
      .select('*')
      .eq('user_id', auth.user.id)
      .in('status', ['active', 'expired'])
      .limit(1)
      .maybeSingle();
    if (existing) {
      return jsonResponse(
        { error: 'SESSION_EXISTS', message: 'A mining session is already active or ready to claim.', activeSession: normalizeSession(existing) },
        409
      );
    }
    const userLevel = await getMembershipLevelByNumber(auth.user.membership_level || 1);
    const mult = Math.max(1, Number(userLevel.mining_multiplier || 1));
    const nowMs = Date.now();
    const ratePerSec = Number(((settings.reward_rate_per_hour * mult) / 3600).toFixed(8));
    const maxReward = Number((settings.max_reward_per_session * mult).toFixed(6));
    const { data: session, error } = await sb
      .from('mining_sessions')
      .insert({
        user_id: auth.user.id,
        reward_rate_per_sec: ratePerSec,
        duration_seconds: settings.mining_duration_seconds,
        max_reward: maxReward,
        started_at: new Date(nowMs).toISOString(),
        ends_at: new Date(nowMs + settings.mining_duration_seconds * 1000).toISOString(),
        status: 'active',
      })
      .select('*')
      .single();
    if (error) return jsonResponse({ error: 'MINING_START_ERROR', message: error.message }, 500);
    return jsonResponse({ session: normalizeSession(session), serverTime: new Date().toISOString() });
  }

  if ((apiPath === '/mining/stop' || apiPath === '/mining/claim') && method === 'POST') {
    const action = apiPath === '/mining/stop' ? 'stop' : 'claim';
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const { settings } = await getSettings();
    if (action === 'claim' && (settings.maintenance_mode || settings.emergency_pause)) {
      return jsonResponse({ error: 'SYSTEM_PAUSED', message: 'Claims are temporarily paused.' }, 403);
    }
    const { data: existing } = await sb
      .from('mining_sessions')
      .select('*')
      .eq('user_id', auth.user.id)
      .in('status', ['active', 'expired'])
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!existing) return jsonResponse({ error: 'NO_SESSION', message: 'No active mining session found.' }, 404);
    const session = normalizeSession(existing);
    const nowMs = Date.now();
    const startMs = new Date(session.started_at).getTime();
    const endMs = new Date(session.ends_at).getTime();
    const elapsedSec = Math.max(0, (Math.min(nowMs, endMs) - startMs) / 1000);
    const cappedEarned = Number(Math.min(elapsedSec * session.reward_rate_per_sec, session.max_reward).toFixed(6));

    if (action === 'claim' && cappedEarned < settings.min_claim_amount) {
      return jsonResponse(
        { error: 'MIN_CLAIM', message: `Minimum claim is ${settings.min_claim_amount} LOVA.` },
        400
      );
    }

    const nowIso = new Date(nowMs).toISOString();
    const nextStatus = cappedEarned > 0 ? 'claimed' : 'stopped';
    const { data: updatedSess, error } = await sb
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
    if (error || !updatedSess) {
      return jsonResponse({ error: 'SETTLE_ERROR', message: 'Mining session already settled.' }, 400);
    }

    if (cappedEarned > 0) {
      await sb.from('mining_rewards').insert({
        user_id: session.user_id,
        session_id: session.id,
        reward_type: 'session_claim',
        amount: cappedEarned,
        is_demo_balance: false,
      });
      await creditUser(
        session.user_id,
        cappedEarned,
        'mining_claim',
        `Mining session reward claimed (${Math.floor(elapsedSec)}s)`
      );

      // Referral commissions L1 & L2
      if (auth.user.referred_by_user_id && settings.referral_l1_percent > 0) {
        const { data: l1 } = await sb.from('users').select('*').eq('id', auth.user.referred_by_user_id).maybeSingle();
        if (l1 && l1.status === 'active') {
          const l1Bonus = Number(((cappedEarned * settings.referral_l1_percent) / 100).toFixed(6));
          if (l1Bonus > 0) {
            await creditUser(l1.id, l1Bonus, 'referral_bonus', `L1 referral commission (${settings.referral_l1_percent}%)`);
            await sb.from('referral_rewards').insert({
              referrer_user_id: l1.id,
              referred_user_id: auth.user.id,
              level: 1,
              reward_source: 'mining_commission',
              amount: l1Bonus,
              source_session_id: session.id,
            });
          }
          if (l1.referred_by_user_id && l1.referred_by_user_id !== auth.user.id && settings.referral_l2_percent > 0) {
            const { data: l2 } = await sb.from('users').select('*').eq('id', l1.referred_by_user_id).maybeSingle();
            if (l2 && l2.status === 'active') {
              const l2Bonus = Number(((cappedEarned * settings.referral_l2_percent) / 100).toFixed(6));
              if (l2Bonus > 0) {
                await creditUser(l2.id, l2Bonus, 'referral_bonus', `L2 referral commission (${settings.referral_l2_percent}%)`);
                await sb.from('referral_rewards').insert({
                  referrer_user_id: l2.id,
                  referred_user_id: auth.user.id,
                  level: 2,
                  reward_source: 'mining_commission',
                  amount: l2Bonus,
                  source_session_id: session.id,
                });
              }
            }
          }
        }
      }
    }

    const { data: freshUser } = await sb.from('users').select('*').eq('id', auth.user.id).single();
    return jsonResponse({
      session: normalizeSession(updatedSess),
      claimedAmount: cappedEarned,
      user: normalizeUser(freshUser!),
      serverTime: new Date().toISOString(),
    });
  }

  if (apiPath === '/mining/history' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const [{ data: sessions }, { data: rewards }] = await Promise.all([
      sb.from('mining_sessions').select('*').eq('user_id', auth.user.id).order('started_at', { ascending: false }).limit(30),
      sb.from('mining_rewards').select('*').eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(30),
    ]);
    return jsonResponse({
      sessions: (sessions || []).map(normalizeSession),
      rewards: (rewards || []).map((r) => ({ ...r, amount: Number(r.amount) })) as MiningReward[],
    });
  }

  // DAILY CHECK-IN
  if (apiPath === '/checkin' && method === 'POST') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const { settings } = await getSettings();
    if (settings.maintenance_mode || settings.emergency_pause) {
      return jsonResponse({ error: 'SYSTEM_PAUSED', message: 'Platform is temporarily paused.' }, 403);
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    if (auth.user.last_checkin_date === todayStr) {
      return jsonResponse({ error: 'CHECKIN_ERROR', message: 'Daily check-in already claimed today (UTC).' }, 400);
    }
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const nextStreak = auth.user.last_checkin_date === yesterday ? auth.user.streak_days + 1 : 1;
    const userLevel = await getMembershipLevelByNumber(auth.user.membership_level || 1);
    const levelMult = Math.max(1, Number(userLevel.daily_bonus_multiplier || 1));
    const rewardAmount = Number((settings.daily_bonus_amount * (1 + Math.min(nextStreak - 1, 6) * 0.1) * levelMult).toFixed(6));

    const { error: ciErr } = await sb.from('daily_checkins').insert({
      user_id: auth.user.id,
      checkin_date: todayStr,
      streak_day: nextStreak,
      reward_amount: rewardAmount,
    });
    if (ciErr) return jsonResponse({ error: 'CHECKIN_ERROR', message: 'Daily check-in already recorded.' }, 400);

    await sb.from('users').update({ streak_days: nextStreak, last_checkin_date: todayStr }).eq('id', auth.user.id);
    await sb.from('mining_rewards').insert({
      user_id: auth.user.id,
      session_id: null,
      reward_type: nextStreak > 1 ? 'streak_bonus' : 'daily_bonus',
      amount: rewardAmount,
      is_demo_balance: false,
    });
    const updatedUser = await creditUser(auth.user.id, rewardAmount, 'daily_checkin', `Daily check-in reward (Day ${nextStreak} streak)`);
    return jsonResponse({ user: updatedUser, streakDay: nextStreak, rewardAmount });
  }

  // MEMBERSHIP LEVEL UP ROUTES (Strictly External LOVA Payment — Never In-App Balance)
  if (apiPath === '/levels' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const [{ settings }, levels, reqRes] = await Promise.all([
      getSettings(),
      getMembershipLevels(false),
      sb
        .from('level_upgrade_requests')
        .select('*')
        .eq('user_id', auth.user.id)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    const tonCfg = resolveTonConfig(cfg, settings);
    const levelNameMap = new Map(levels.map((l) => [l.level_number, l.name]));
    const currentLevel = auth.user.membership_level || 1;
    const currentMembership = levels.find((l) => l.level_number === currentLevel) || levels[0];
    return jsonResponse({
      currentLevel,
      currentMembership,
      levels,
      requests: (reqRes.data || []).map((r) => ({
        ...normalizeLevelUpgradeRow(r),
        target_level_name: levelNameMap.get(Number(r.target_level)) || `Level ${r.target_level}`,
      })),
      adminLovaWalletAddress: tonCfg.adminLovaWallet,
      lovaJettonMasterAddress: tonCfg.lovaMaster,
    });
  }

  if (apiPath === '/levels/upgrade-request' && method === 'POST') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const { settings } = await getSettings();
    if (settings.maintenance_mode || settings.emergency_pause) {
      return jsonResponse({ error: 'SYSTEM_PAUSED', message: 'Level upgrades are temporarily paused.' }, 403);
    }
    const tonCfg = resolveTonConfig(cfg, settings);
    if (!tonCfg.adminLovaWallet) {
      return jsonResponse(
        {
          error: 'ADMIN_LOVA_WALLET_NOT_CONFIGURED',
          message: 'Official Admin LOVA wallet address is not configured yet. Ask an administrator to set it in Settings.',
        },
        503
      );
    }
    const body = await readJson<{ targetLevel?: number; txHash?: string; senderWalletAddress?: string }>();
    const targetLevel = Number(body.targetLevel);
    if (!Number.isInteger(targetLevel) || targetLevel < 2) {
      return jsonResponse({ error: 'INVALID_TARGET_LEVEL', message: 'Select a valid level above your current tier.' }, 400);
    }
    const txHash = safeText(body.txHash, 256);
    if (!txHash || txHash.length < 16) {
      return jsonResponse({ error: 'MISSING_TX_HASH', message: 'Enter the TON payment transaction hash (TXID).' }, 400);
    }

    const levels = await getMembershipLevels(false);
    const targetTier = levels.find((l) => l.level_number === targetLevel);
    if (!targetTier || targetTier.required_lova_amount <= 0) {
      return jsonResponse({ error: 'LEVEL_UNAVAILABLE', message: 'Selected membership level is unavailable.' }, 400);
    }
    if (targetTier.level_number <= (auth.user.membership_level || 1)) {
      return jsonResponse(
        { error: 'ALREADY_AT_LEVEL', message: `Your account is already at Level ${auth.user.membership_level}.` },
        400
      );
    }

    let senderWalletAddress: string | null = null;
    const rawSender = safeText(body.senderWalletAddress, 128);
    if (rawSender) {
      const normSender = normalizeTonAddress(rawSender);
      if (!normSender) return jsonResponse({ error: 'INVALID_SENDER_WALLET', message: 'Sender TON wallet address is invalid.' }, 400);
      senderWalletAddress = normSender.friendly;
    } else {
      const { data: activeWallet } = await sb
        .from('user_wallets')
        .select('wallet_address')
        .eq('user_id', auth.user.id)
        .eq('is_active', true)
        .maybeSingle();
      senderWalletAddress = activeWallet?.wallet_address || null;
    }

    const [{ data: existingPending }, { data: dupUpgrade }, { data: dupGram }] = await Promise.all([
      sb.from('level_upgrade_requests').select('id').eq('user_id', auth.user.id).eq('status', 'Pending').limit(1),
      sb.from('level_upgrade_requests').select('id').eq('tx_hash', txHash).maybeSingle(),
      sb.from('wallet_verifications').select('id').eq('tx_hash', txHash).maybeSingle(),
    ]);

    if (existingPending && existingPending.length > 0) {
      return jsonResponse(
        { error: 'PENDING_REQUEST_EXISTS', message: 'You already have a Pending level-up payment under admin review.' },
        409
      );
    }
    if (dupUpgrade || dupGram) {
      return jsonResponse({ error: 'DUPLICATE_TX_HASH', message: 'This transaction hash has already been submitted.' }, 409);
    }

    const now = new Date().toISOString();
    // Strictly never deducts or touches users.available_balance, pending_balance, or total_earned.
    const { data, error } = await sb
      .from('level_upgrade_requests')
      .insert({
        user_id: auth.user.id,
        from_level: auth.user.membership_level || 1,
        target_level: targetTier.level_number,
        required_lova_amount: targetTier.required_lova_amount,
        admin_wallet_address: tonCfg.adminLovaWallet,
        sender_wallet_address: senderWalletAddress,
        tx_hash: txHash,
        status: 'Pending',
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    if (error) return jsonResponse({ error: 'LEVEL_UPGRADE_REQUEST_ERROR', message: error.message }, 400);
    return jsonResponse({
      request: {
        ...normalizeLevelUpgradeRow(data),
        target_level_name: targetTier.name,
      },
    });
  }

  // TASKS
  const getTasksForUser = async (userId: string, includeInactive = false): Promise<TaskItem[]> => {
    let q = sb.from('tasks').select('*').order('sort_order', { ascending: true });
    if (!includeInactive) q = q.eq('is_active', true);
    const [{ data: tasks }, { data: completions }] = await Promise.all([
      q,
      sb.from('task_completions').select('*').eq('user_id', userId),
    ]);
    const compMap = new Map((completions || []).map((c) => [c.task_id, c]));
    return (tasks || []).map((t) => {
      const comp = compMap.get(t.id);
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
  };

  const getUserTaskStats = async (userId: string) => {
    const [{ count: refCount }, { count: sessionCount }, { data: wallet }] = await Promise.all([
      sb.from('referrals').select('*', { count: 'exact', head: true }).eq('referrer_user_id', userId).eq('level', 1),
      sb.from('mining_sessions').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'claimed'),
      sb.from('user_wallets').select('is_verified,is_suspended').eq('user_id', userId).eq('is_active', true).maybeSingle(),
    ]);
    return {
      referralCount: refCount || 0,
      completedMiningSessions: sessionCount || 0,
      hasVerifiedWallet: Boolean(wallet?.is_verified && !wallet?.is_suspended),
    };
  };

  if (apiPath === '/tasks' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const [tasks, stats] = await Promise.all([getTasksForUser(auth.user.id), getUserTaskStats(auth.user.id)]);
    return jsonResponse({ tasks, stats });
  }

  const taskStartMatch = apiPath.match(/^\/tasks\/([^/]+)\/start$/);
  if (taskStartMatch && method === 'POST') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const taskId = taskStartMatch[1];
    const { data: task } = await sb.from('tasks').select('*').eq('id', taskId).maybeSingle();
    if (!task || !task.is_active) return jsonResponse({ error: 'TASK_NOT_FOUND', message: 'Task not found.' }, 404);
    const { data: existing } = await sb
      .from('task_completions')
      .select('*')
      .eq('user_id', auth.user.id)
      .eq('task_id', taskId)
      .maybeSingle();
    if (existing) return jsonResponse({ ok: true, completion: existing });
    const { data: created, error } = await sb
      .from('task_completions')
      .insert({ user_id: auth.user.id, task_id: taskId, status: 'started', started_at: new Date().toISOString() })
      .select('*')
      .single();
    if (error) return jsonResponse({ error: 'TASK_START_ERROR', message: error.message }, 400);
    return jsonResponse({ ok: true, completion: created });
  }

  const taskVerifyMatch = apiPath.match(/^\/tasks\/([^/]+)\/verify$/);
  if (taskVerifyMatch && method === 'POST') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const taskId = taskVerifyMatch[1];
    const { data: taskRow } = await sb.from('tasks').select('*').eq('id', taskId).maybeSingle();
    if (!taskRow || !taskRow.is_active) return jsonResponse({ error: 'TASK_NOT_FOUND', message: 'Task not found.' }, 404);
    const task = { ...taskRow, reward_amount: Number(taskRow.reward_amount) } as TaskItem;

    const { data: existingComp } = await sb
      .from('task_completions')
      .select('*')
      .eq('user_id', auth.user.id)
      .eq('task_id', task.id)
      .maybeSingle();
    if (existingComp?.status === 'completed') {
      return jsonResponse({ error: 'ALREADY_COMPLETED', message: 'Already claimed.' }, 409);
    }

    const stats = await getUserTaskStats(auth.user.id);
    const body = await readJson<{ code?: string }>();

    if (task.category === 'wallet_verified' && !stats.hasVerifiedWallet) {
      return jsonResponse({ error: 'WALLET_NOT_VERIFIED', message: 'Complete 0.05 GRAM KYC verification first.' }, 422);
    } else if (task.category === 'referral_milestone' && stats.referralCount < task.required_count) {
      return jsonResponse({ error: 'MILESTONE_NOT_MET', message: `${stats.referralCount}/${task.required_count} referrals.` }, 422);
    } else if (task.category === 'mining_sessions' && stats.completedMiningSessions < task.required_count) {
      return jsonResponse({ error: 'MILESTONE_NOT_MET', message: `${stats.completedMiningSessions}/${task.required_count} sessions.` }, 422);
    } else if (task.category === 'telegram_channel') {
      if (!cfg.telegramBotToken || !task.telegram_chat_id) {
        return jsonResponse({ error: 'TELEGRAM_BOT_NOT_CONFIGURED', message: 'Channel verification unavailable.' }, 422);
      }
      const memberRes = await fetch(
        `https://api.telegram.org/bot${cfg.telegramBotToken}/getChatMember?chat_id=${encodeURIComponent(
          task.telegram_chat_id
        )}&user_id=${auth.user.telegram_id}`
      );
      const memberJson = (await memberRes.json()) as { ok?: boolean; result?: { status?: string } };
      if (!memberJson.ok || !['member', 'administrator', 'creator'].includes(memberJson.result?.status || '')) {
        return jsonResponse({ error: 'NOT_CHANNEL_MEMBER', message: 'Not a channel member yet.' }, 422);
      }
    } else if (!['wallet_verified', 'referral_milestone', 'mining_sessions', 'telegram_channel'].includes(task.category)) {
      if (task.action_url) {
        if (!existingComp?.started_at) {
          return jsonResponse({ error: 'TASK_NOT_STARTED', message: 'Open the task link first.' }, 422);
        }
        const minDwellMs = task.category === 'ads_code' ? 5000 : 10000;
        const elapsed = Date.now() - new Date(existingComp.started_at).getTime();
        if (elapsed < minDwellMs) {
          return jsonResponse(
            { error: 'VERIFICATION_DWELL_REQUIRED', message: `Wait ${Math.ceil((minDwellMs - elapsed) / 1000)}s.` },
            422
          );
        }
      }
      if (task.verification_code) {
        const submitted = safeText(body.code, 64);
        if (!submitted || submitted.toLowerCase() !== task.verification_code.trim().toLowerCase()) {
          return jsonResponse({ error: 'INVALID_VERIFICATION_CODE', message: 'Invalid verification code.' }, 422);
        }
      }
    }

    const now = new Date().toISOString();
    await sb.from('task_completions').upsert(
      {
        user_id: auth.user.id,
        task_id: task.id,
        started_at: existingComp?.started_at || now,
        completed_at: now,
        reward_amount: task.reward_amount,
        status: 'completed',
        verification_meta: { verifiedAt: now },
      },
      { onConflict: 'user_id,task_id' }
    );
    const updatedUser = await creditUser(auth.user.id, task.reward_amount, 'task_reward', `Task completed: ${task.title}`);
    const tasks = await getTasksForUser(auth.user.id);
    return jsonResponse({ user: updatedUser, tasks, awarded: task.reward_amount });
  }

  // REFERRALS & LEADERBOARD
  if (apiPath === '/referrals' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const [{ settings }, { data: refs }, { data: rewards }, botName] = await Promise.all([
      getSettings(),
      sb.from('referrals').select('*').eq('referrer_user_id', auth.user.id).order('created_at', { ascending: false }),
      sb.from('referral_rewards').select('*').eq('referrer_user_id', auth.user.id).order('created_at', { ascending: false }).limit(50),
      getBotUsername(),
    ]);
    const refIds = (refs || []).map((r) => r.referred_user_id);
    let userMap = new Map<string, LovaUser>();
    if (refIds.length > 0) {
      const { data: invitedUsers } = await sb.from('users').select('*').in('id', refIds);
      userMap = new Map((invitedUsers || []).map((u) => [u.id, normalizeUser(u)]));
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
    const totalReferralEarned = Number((rewards || []).reduce((acc, r) => acc + Number(r.amount), 0).toFixed(6));
    return jsonResponse({
      referralCode: auth.user.referral_code,
      telegramInviteUrl: botName ? `https://t.me/${botName}?startapp=ref_${auth.user.referral_code}` : null,
      webInviteUrl: `${cfg.appUrl}/?ref=${auth.user.referral_code}`,
      config: {
        l1FixedBonus: settings.referral_l1_fixed_bonus,
        l1Percent: settings.referral_l1_percent,
        l2Percent: settings.referral_l2_percent,
      },
      level1Count: invited.filter((i) => i.level === 1).length,
      level2Count: invited.filter((i) => i.level === 2).length,
      totalReferralEarned,
      invited,
      rewards: (rewards || []).map((r) => ({ ...r, amount: Number(r.amount) })),
    });
  }

  if (apiPath === '/leaderboard' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const tab = url.searchParams.get('tab') === 'referrals' ? 'referrals' : 'miners';
    const period = url.searchParams.get('period') === 'weekly' ? 'weekly' : url.searchParams.get('period') === 'monthly' ? 'monthly' : 'all';
    const cutoffIso =
      period === 'weekly'
        ? new Date(Date.now() - 7 * 86400000).toISOString()
        : period === 'monthly'
          ? new Date(Date.now() - 30 * 86400000).toISOString()
          : null;

    const [{ data: users }, { count: totalUsers }, { count: totalReferrals }, { data: allRewards }] = await Promise.all([
      sb.from('users').select('id,telegram_id,username,first_name,total_earned,status'),
      sb.from('users').select('*', { count: 'exact', head: true }),
      sb.from('referrals').select('*', { count: 'exact', head: true }),
      sb.from('mining_rewards').select('amount'),
    ]);
    const activeUsers = (users || []).filter((u) => u.status === 'active');
    const userMap = new Map(activeUsers.map((u) => [u.id, u]));

    let entries: Array<{ rank: number; userId: string; handle: string; score: number; unit: string }> = [];
    if (tab === 'miners') {
      if (!cutoffIso) {
        entries = activeUsers
          .sort((a, b) => Number(b.total_earned) - Number(a.total_earned))
          .slice(0, 25)
          .map((u, idx) => ({
            rank: idx + 1,
            userId: u.id,
            handle: maskDisplayName(u),
            score: Number(Number(u.total_earned).toFixed(2)),
            unit: 'LOVA',
          }));
      } else {
        const { data: rewards } = await sb.from('mining_rewards').select('user_id,amount').gte('created_at', cutoffIso);
        const totals = new Map<string, number>();
        for (const r of rewards || []) totals.set(r.user_id, (totals.get(r.user_id) || 0) + Number(r.amount));
        entries = Array.from(totals.entries())
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
    } else {
      let rq = sb.from('referrals').select('referrer_user_id').eq('level', 1);
      if (cutoffIso) rq = rq.gte('created_at', cutoffIso);
      const { data: refs } = await rq;
      const counts = new Map<string, number>();
      for (const r of refs || []) counts.set(r.referrer_user_id, (counts.get(r.referrer_user_id) || 0) + 1);
      entries = Array.from(counts.entries())
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

    return jsonResponse({
      tab,
      period,
      entries,
      platformStats: {
        totalMiners: totalUsers || 0,
        totalMiningRewards: Number((allRewards || []).reduce((a, r) => a + Number(r.amount), 0).toFixed(4)),
        totalReferrals: totalReferrals || 0,
      },
    });
  }

  // WALLET & 0.05 GRAM KYC VERIFICATION
  if (apiPath === '/wallet/connect' && method === 'POST') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const body = await readJson<{ address?: string; provider?: string }>();
    const norm = normalizeTonAddress(safeText(body.address, 128));
    if (!norm) return jsonResponse({ error: 'INVALID_TON_ADDRESS', message: 'Invalid TON wallet address.' }, 400);

    const now = new Date().toISOString();
    await sb.from('user_wallets').update({ is_active: false, updated_at: now }).eq('user_id', auth.user.id);
    const { data: existing } = await sb
      .from('user_wallets')
      .select('*')
      .eq('user_id', auth.user.id)
      .eq('raw_address', norm.raw)
      .maybeSingle();

    if (existing) {
      const { data, error } = await sb
        .from('user_wallets')
        .update({ wallet_address: norm.friendly, wallet_provider: safeText(body.provider, 64) || null, is_active: true, updated_at: now })
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) return jsonResponse({ error: 'WALLET_CONNECT_ERROR', message: error.message }, 400);
      return jsonResponse({ wallet: data });
    }

    const { data, error } = await sb
      .from('user_wallets')
      .insert({
        user_id: auth.user.id,
        wallet_address: norm.friendly,
        raw_address: norm.raw,
        wallet_provider: safeText(body.provider, 64) || null,
        is_active: true,
        is_verified: false,
        is_suspended: false,
      })
      .select('*')
      .single();
    if (error) return jsonResponse({ error: 'WALLET_CONNECT_ERROR', message: error.message }, 400);
    return jsonResponse({ wallet: data });
  }

  if (apiPath === '/wallet/disconnect' && method === 'POST') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    await sb.from('user_wallets').update({ is_active: false, updated_at: new Date().toISOString() }).eq('user_id', auth.user.id);
    return jsonResponse({ ok: true });
  }

  if (apiPath === '/wallet/onchain-balances' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const { data: wallet } = await sb
      .from('user_wallets')
      .select('*')
      .eq('user_id', auth.user.id)
      .eq('is_active', true)
      .maybeSingle();
    if (!wallet) return jsonResponse({ balances: null });

    const { settings } = await getSettings();
    const tonCfg = resolveTonConfig(cfg, settings);
    const norm = normalizeTonAddress(wallet.wallet_address);
    if (!norm) return jsonResponse({ balances: null });

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (cfg.tonApiKey) headers.Authorization = `Bearer ${cfg.tonApiKey}`;

    const [accRes, jetRes] = await Promise.all([
      fetch(`${cfg.tonApiEndpoint}/accounts/${encodeURIComponent(norm.raw)}`, { headers }).catch(() => null),
      fetch(`${cfg.tonApiEndpoint}/accounts/${encodeURIComponent(norm.raw)}/jettons`, { headers }).catch(() => null),
    ]);

    const lovaNorm = tonCfg.lovaMaster ? normalizeTonAddress(tonCfg.lovaMaster) : null;
    const gramNorm = tonCfg.gramMaster ? normalizeTonAddress(tonCfg.gramMaster) : null;

    const balances: OnChainWalletBalances = {
      tonBalance: '0',
      lovaBalance: lovaNorm ? '0' : null,
      lovaJettonWallet: null,
      gramBalance: gramNorm ? '0' : null,
      gramJettonWallet: null,
    };

    if (accRes?.ok) {
      const acc = (await accRes.json().catch(() => null)) as { balance?: string | number } | null;
      if (acc?.balance !== undefined) balances.tonBalance = formatBaseUnits(String(acc.balance), 9);
    }

    if (jetRes?.ok) {
      const jet = (await jetRes.json().catch(() => null)) as {
        balances?: Array<{
          balance?: string;
          wallet_address?: { address?: string };
          jetton?: { address?: string; decimals?: number };
        }>;
      } | null;
      for (const item of jet?.balances || []) {
        const mRaw = normalizeRaw(item.jetton?.address);
        if (!mRaw) continue;
        const dec = Number(item.jetton?.decimals ?? 9);
        const jAddr = normalizeFriendly(item.wallet_address?.address) || item.wallet_address?.address || null;
        if (lovaNorm && mRaw === lovaNorm.raw) {
          balances.lovaBalance = formatBaseUnits(String(item.balance || '0'), dec);
          balances.lovaJettonWallet = jAddr;
        }
        if (gramNorm && mRaw === gramNorm.raw) {
          balances.gramBalance = formatBaseUnits(String(item.balance || '0'), dec);
          balances.gramJettonWallet = jAddr;
        }
      }
    }

    return jsonResponse({ balances });
  }

  if (apiPath === '/wallet/verify-gram' && method === 'POST') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const { settings } = await getSettings();
    const { data: activeWallet } = await sb
      .from('user_wallets')
      .select('*')
      .eq('user_id', auth.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!activeWallet) return jsonResponse({ error: 'NO_WALLET', message: 'Connect a TON wallet first.' }, 400);
    if (activeWallet.is_suspended) return jsonResponse({ error: 'WALLET_SUSPENDED', message: 'Wallet suspended.' }, 403);
    if (activeWallet.is_verified) return jsonResponse({ wallet: activeWallet, alreadyVerified: true });

    const tonCfg = resolveTonConfig(cfg, settings);
    if (!tonCfg.adminWallet || !tonCfg.gramMaster || !Number.isInteger(tonCfg.gramDecimals)) {
      return jsonResponse(
        {
          error: 'GRAM_VERIFICATION_NOT_CONFIGURED',
          message: 'GRAM Jetton KYC verification requires GRAM_JETTON_MASTER_ADDRESS and ADMIN_TON_WALLET_ADDRESS.',
        },
        503
      );
    }

    const body = await readJson<{ txHash?: string }>();
    const txHash = safeText(body.txHash, 256);
    if (!txHash || txHash.length < 16) {
      return jsonResponse({ error: 'MISSING_TX_HASH', message: 'Valid TON transaction hash required.' }, 400);
    }

    const { data: usedTx } = await sb.from('wallet_verifications').select('id').eq('tx_hash', txHash).maybeSingle();
    if (usedTx) {
      return jsonResponse({ error: 'DUPLICATE_TX_HASH', message: 'Transaction hash already used.' }, 409);
    }

    const masterNorm = normalizeTonAddress(tonCfg.gramMaster)!;
    const adminNorm = normalizeTonAddress(tonCfg.adminWallet)!;
    const senderNorm = normalizeTonAddress(activeWallet.wallet_address)!;
    const expectedRaw = toBaseUnits(settings.gram_verification_fee, tonCfg.gramDecimals);

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (cfg.tonApiKey) headers.Authorization = `Bearer ${cfg.tonApiKey}`;
    const tonRes = await fetch(`${cfg.tonApiEndpoint}/events/${encodeURIComponent(txHash)}`, { headers });
    if (!tonRes.ok) {
      return jsonResponse(
        {
          error: 'TON_API_TX_NOT_FOUND',
          message: `Transaction not yet finalized or not found on TON explorer (HTTP ${tonRes.status}).`,
        },
        422
      );
    }

    const event = (await tonRes.json()) as {
      event_id?: string;
      in_progress?: boolean;
      actions?: Array<{
        type?: string;
        status?: string;
        JettonTransfer?: {
          sender?: { address?: string };
          recipient?: { address?: string };
          amount?: string;
          jetton?: { address?: string };
        };
      }>;
    };

    if (event.in_progress) {
      return jsonResponse({ error: 'TX_PENDING_FINALITY', message: 'Transaction still confirming on TON.' }, 422);
    }

    const match = (event.actions || []).find((act) => {
      if (act.type !== 'JettonTransfer' || act.status !== 'ok' || !act.JettonTransfer) return false;
      const jt = act.JettonTransfer;
      const m = normalizeRaw(jt.jetton?.address);
      const s = normalizeRaw(jt.sender?.address);
      const r = normalizeRaw(jt.recipient?.address);
      if (!m || !s || !r || !jt.amount) return false;
      try {
        return m === masterNorm.raw && s === senderNorm.raw && r === adminNorm.raw && BigInt(jt.amount) >= expectedRaw;
      } catch {
        return false;
      }
    });

    if (!match) {
      return jsonResponse(
        {
          error: 'JETTON_TRANSFER_MISMATCH',
          message: `No finalized ${settings.gram_verification_fee} GRAM transfer from your wallet to the Admin wallet was found.`,
        },
        422
      );
    }

    const finalHash = event.event_id || txHash;
    const { data: dupCheck } = await sb.from('wallet_verifications').select('id').eq('tx_hash', finalHash).maybeSingle();
    if (dupCheck) return jsonResponse({ error: 'DUPLICATE_TX_HASH', message: 'Event already claimed.' }, 409);

    const now = new Date().toISOString();
    const { data: ver, error: verErr } = await sb
      .from('wallet_verifications')
      .insert({
        user_id: auth.user.id,
        wallet_id: activeWallet.id,
        tx_hash: finalHash,
        sender_address: senderNorm.raw,
        recipient_address: adminNorm.raw,
        jetton_master_address: masterNorm.raw,
        amount_raw: expectedRaw.toString(),
        amount_display: settings.gram_verification_fee,
        decimals: tonCfg.gramDecimals,
        status: 'verified',
        verified_at: now,
      })
      .select('*')
      .single();
    if (verErr) return jsonResponse({ error: 'DUPLICATE_TX_HASH', message: 'Transaction already recorded.' }, 409);

    const { data: wallet } = await sb
      .from('user_wallets')
      .update({ is_verified: true, verified_at: now, updated_at: now })
      .eq('id', activeWallet.id)
      .select('*')
      .single();

    await sb.from('transactions').insert({
      user_id: auth.user.id,
      tx_type: 'gram_verification',
      amount: settings.gram_verification_fee,
      currency: 'GRAM',
      chain_tx_hash: finalHash,
      description: `KYC verified TON wallet via ${settings.gram_verification_fee} GRAM Jetton transfer`,
      is_demo: false,
    });

    return jsonResponse({ wallet, verification: ver });
  }

  if (apiPath === '/wallet/verifications' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const { data } = await sb
      .from('wallet_verifications')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false });
    return jsonResponse({ verifications: data || [] });
  }

  // WITHDRAWALS & TRANSACTIONS (Enforces 0.05 GRAM KYC)
  if (apiPath === '/withdrawals' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const [{ data: withdrawals }, { settings }] = await Promise.all([
      sb.from('withdrawals').select('*').eq('user_id', auth.user.id).order('created_at', { ascending: false }),
      getSettings(),
    ]);
    return jsonResponse({
      withdrawals: (withdrawals || []).map((w) => ({ ...w, amount: Number(w.amount) })),
      limits: { minWithdrawal: settings.min_withdrawal, maxWithdrawal: settings.max_withdrawal },
      isDemoTokenMode: false,
      isLiveTokenMode: true,
    });
  }

  if (apiPath === '/withdrawals/request' && method === 'POST') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const { settings } = await getSettings();
    if (settings.maintenance_mode || settings.emergency_pause) {
      return jsonResponse({ error: 'SYSTEM_PAUSED', message: 'Withdrawals are temporarily paused.' }, 403);
    }

    const { data: activeWallet } = await sb
      .from('user_wallets')
      .select('*')
      .eq('user_id', auth.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!activeWallet) return jsonResponse({ error: 'WALLET_REQUIRED', message: 'Connect a TON wallet first.' }, 400);
    if (activeWallet.is_suspended) return jsonResponse({ error: 'WALLET_SUSPENDED', message: 'Wallet suspended.' }, 403);
    if (!activeWallet.is_verified) {
      return jsonResponse(
        {
          error: 'WALLET_UNVERIFIED',
          message: 'KYC required: Complete the 0.05 GRAM wallet verification before requesting a withdrawal.',
        },
        422
      );
    }

    const body = await readJson<{ amount?: number }>();
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonResponse({ error: 'INVALID_AMOUNT', message: 'Enter a valid withdrawal amount.' }, 400);
    }
    if (amount < settings.min_withdrawal || amount > settings.max_withdrawal) {
      return jsonResponse(
        { error: 'OUT_OF_RANGE', message: `Withdrawal must be between ${settings.min_withdrawal} and ${settings.max_withdrawal} LOVA.` },
        400
      );
    }
    const cleanAmount = Number(amount.toFixed(6));
    if (cleanAmount > auth.user.available_balance) {
      return jsonResponse({ error: 'INSUFFICIENT_BALANCE', message: 'Insufficient available LOVA balance.' }, 400);
    }

    const now = new Date().toISOString();
    const { data: uData, error: uErr } = await sb
      .from('users')
      .update({
        available_balance: Number((auth.user.available_balance - cleanAmount).toFixed(6)),
        pending_balance: Number((auth.user.pending_balance + cleanAmount).toFixed(6)),
        updated_at: now,
      })
      .eq('id', auth.user.id)
      .gte('available_balance', cleanAmount)
      .select('*')
      .single();
    if (uErr || !uData) return jsonResponse({ error: 'BALANCE_ERROR', message: 'Insufficient balance.' }, 400);

    const { data: wData, error: wErr } = await sb
      .from('withdrawals')
      .insert({
        user_id: auth.user.id,
        destination_address: activeWallet.wallet_address,
        amount: cleanAmount,
        is_demo_request: false,
        status: 'Pending',
      })
      .select('*')
      .single();
    if (wErr) return jsonResponse({ error: 'WITHDRAWAL_ERROR', message: wErr.message }, 400);

    await sb.from('transactions').insert({
      user_id: auth.user.id,
      tx_type: 'withdrawal_request',
      amount: cleanAmount,
      currency: 'LOVA',
      chain_tx_hash: null,
      description: `Withdrawal requested to ${activeWallet.wallet_address.slice(0, 8)}...${activeWallet.wallet_address.slice(-6)}`,
      is_demo: false,
    });

    return jsonResponse({
      user: normalizeUser(uData),
      withdrawal: { ...wData, amount: Number(wData.amount) },
    });
  }

  if (apiPath === '/transactions' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const { data } = await sb
      .from('transactions')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    return jsonResponse({ transactions: (data || []).map((t) => ({ ...t, amount: Number(t.amount) })) });
  }

  // ============================================================================
  // ADMIN PANEL ROUTES
  // ============================================================================
  if (apiPath === '/admin/login' && method === 'POST') {
    const body = await readJson<{ secret?: string; bootstrapPreviewAdmin?: boolean }>();
    const secretInput = typeof body.secret === 'string' ? body.secret.trim() : '';

    if (secretInput && cfg.adminBootstrapSecret) {
      const a = Buffer.from(secretInput);
      const b = Buffer.from(cfg.adminBootstrapSecret);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        const adminId = 'env-super-admin';
        const token = signSessionToken(
          { sub: adminId, tgId: 0, kind: 'admin', adminId, adminRole: 'super_admin' },
          cfg.sessionSecret,
          60 * 60 * 8
        );
        await sb.from('admin_audit_logs').insert({
          admin_id: adminId,
          admin_role: 'super_admin',
          action: 'ADMIN_LOGIN',
          target_type: 'auth',
          target_id: adminId,
          details: { method: 'bootstrap_secret' },
        });
        return jsonResponse(
          { adminToken: token, role: 'super_admin', displayName: 'Super Admin' },
          200,
          { 'Set-Cookie': buildCookieHeader(ADMIN_COOKIE, token, 60 * 60 * 8, isHttps) }
        );
      }
      return jsonResponse({ error: 'INVALID_ADMIN_SECRET', message: 'Invalid administrator secret.' }, 401);
    }

    const userToken = extractBearerOrCookie(request, SESSION_COOKIE, 'authorization');
    const userClaims = verifySessionToken(userToken, cfg.sessionSecret);
    if (userClaims && userClaims.kind === 'user') {
      const tgId = userClaims.tgId;
      const { data: dbAdmin } = await sb
        .from('admins')
        .select('*')
        .eq('telegram_id', tgId)
        .eq('is_active', true)
        .maybeSingle();
      if (dbAdmin || cfg.adminTelegramIds.includes(tgId)) {
        const role: AdminRole = (dbAdmin?.role as AdminRole) || 'super_admin';
        const adminId = dbAdmin?.id || `tg-${tgId}`;
        const token = signSessionToken(
          { sub: userClaims.sub, tgId, kind: 'admin', adminId, adminRole: role },
          cfg.sessionSecret,
          60 * 60 * 8
        );
        return jsonResponse(
          { adminToken: token, role, displayName: dbAdmin?.display_name || `Telegram Admin (${tgId})` },
          200,
          { 'Set-Cookie': buildCookieHeader(ADMIN_COOKIE, token, 60 * 60 * 8, isHttps) }
        );
      }
    }

    return jsonResponse(
      {
        error: 'ADMIN_AUTH_FAILED',
        message: 'Provide a valid server ADMIN_BOOTSTRAP_SECRET or sign in with an authorized Telegram Admin ID.',
      },
      401
    );
  }

  if (apiPath === '/admin/logout' && method === 'POST') {
    return jsonResponse(
      { ok: true },
      200,
      { 'Set-Cookie': buildCookieHeader(ADMIN_COOKIE, '', 0, isHttps) }
    );
  }

  if (apiPath === '/admin/me' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    return jsonResponse({ adminId: admin.adminId, role: admin.adminRole, telegramId: admin.tgId });
  }

  if (apiPath === '/admin/overview' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const dayAgo = new Date(Date.now() - 86400000).toISOString();
    const [
      { settings, schemaReady },
      { count: totalUsers },
      { count: activeUsers },
      { data: rewards },
      { data: withdrawals },
      { count: totalReferrals },
      { data: verifications },
      { count: activeMiners },
      { count: pendingLevelUpgrades },
    ] = await Promise.all([
      getSettings(),
      sb.from('users').select('*', { count: 'exact', head: true }),
      sb.from('users').select('*', { count: 'exact', head: true }).gte('last_active_at', dayAgo),
      sb.from('mining_rewards').select('amount'),
      sb.from('withdrawals').select('status,amount'),
      sb.from('referrals').select('*', { count: 'exact', head: true }),
      sb.from('wallet_verifications').select('amount_display,status').eq('status', 'verified'),
      sb.from('mining_sessions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      sb.from('level_upgrade_requests').select('*', { count: 'exact', head: true }).eq('status', 'Pending'),
    ]);

    return jsonResponse({
      overview: {
        totalUsers: totalUsers || 0,
        activeUsers: activeUsers || 0,
        activeMiners: activeMiners || 0,
        totalMiningRewards: Number((rewards || []).reduce((a, r) => a + Number(r.amount), 0).toFixed(4)),
        pendingWithdrawals: (withdrawals || []).filter((w) => w.status === 'Pending').length,
        completedWithdrawals: (withdrawals || []).filter((w) => w.status === 'Paid').length,
        totalReferrals: totalReferrals || 0,
        verifiedWalletsCount: (verifications || []).length,
        totalGramFeesReceived: Number(
          (verifications || []).reduce((a, v) => a + Number(v.amount_display), 0).toFixed(4)
        ),
        pendingLevelUpgrades: pendingLevelUpgrades || 0,
      },
      settings,
      systemStatus: buildSystemStatus(cfg, schemaReady, settings),
    });
  }

  if (apiPath === '/admin/users' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const search = (url.searchParams.get('search') || '').trim();
    let q = sb.from('users').select('*').order('created_at', { ascending: false }).limit(100);
    if (search && /^\d+$/.test(search)) q = sb.from('users').select('*').eq('telegram_id', Number(search));
    else if (search) q = sb.from('users').select('*').ilike('username', `%${search}%`).limit(50);

    const [{ data: users }, { data: wallets }] = await Promise.all([
      q,
      sb.from('user_wallets').select('*').eq('is_active', true),
    ]);
    const wMap = new Map((wallets || []).map((w) => [w.user_id, w as UserWallet]));
    return jsonResponse({
      users: (users || []).map((u) => ({ ...normalizeUser(u), wallet: wMap.get(u.id) || null })),
    });
  }

  const userStatusMatch = apiPath.match(/^\/admin\/users\/([^/]+)\/status$/);
  if (userStatusMatch && method === 'POST') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const body = await readJson<{ status?: UserStatus; reason?: string }>();
    if (!body.status || !['active', 'suspended', 'banned'].includes(body.status)) {
      return jsonResponse({ error: 'INVALID_STATUS', message: 'Invalid status.' }, 400);
    }
    const { data, error } = await sb
      .from('users')
      .update({ status: body.status, ban_reason: safeText(body.reason, 200) || null, updated_at: new Date().toISOString() })
      .eq('id', userStatusMatch[1])
      .select('*')
      .single();
    if (error) return jsonResponse({ error: 'USER_STATUS_ERROR', message: error.message }, 400);
    return jsonResponse({ user: normalizeUser(data) });
  }

  if (apiPath === '/admin/settings' && method === 'PATCH') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    if (admin.adminRole === 'moderator') {
      return jsonResponse({ error: 'FORBIDDEN_ROLE', message: 'Moderators cannot change settings.' }, 403);
    }
    const body = await readJson<Record<string, unknown>>();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const numFields = [
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
      'lova_jetton_decimals',
      'gram_jetton_decimals',
    ];
    for (const f of numFields) {
      if (body[f] !== undefined && Number.isFinite(Number(body[f])) && Number(body[f]) >= 0) {
        patch[f] = Number(body[f]);
      }
    }
    for (const f of ['mining_enabled', 'emergency_pause', 'maintenance_mode']) {
      if (typeof body[f] === 'boolean') patch[f] = body[f];
    }
    if (typeof body.app_name === 'string' && body.app_name.trim()) patch.app_name = safeText(body.app_name, 64);

    for (const addrField of [
      'admin_ton_wallet_override',
      'admin_lova_wallet_address',
      'lova_jetton_master_address',
      'gram_jetton_master_address',
    ]) {
      if (typeof body[addrField] === 'string') {
        const trimmed = (body[addrField] as string).trim();
        if (!trimmed) {
          patch[addrField] = null;
        } else {
          const norm = normalizeTonAddress(trimmed);
          if (!norm) return jsonResponse({ error: 'INVALID_TON_ADDRESS', message: `Invalid TON address for ${addrField}.` }, 400);
          patch[addrField] = norm.friendly;
        }
      }
    }

    const { data, error } = await sb.from('app_settings').update(patch).eq('id', 1).select('*').single();
    if (error) return jsonResponse({ error: 'SETTINGS_ERROR', message: error.message }, 400);
    return jsonResponse({ settings: { ...DEFAULT_SETTINGS, ...data } });
  }

  if (apiPath === '/admin/withdrawals' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const [{ data: rows }, { data: users }] = await Promise.all([
      sb.from('withdrawals').select('*').order('created_at', { ascending: false }).limit(100),
      sb.from('users').select('id,telegram_id,username,first_name'),
    ]);
    const uMap = new Map((users || []).map((u) => [u.id, u]));
    return jsonResponse({
      withdrawals: (rows || []).map((w) => {
        const u = uMap.get(w.user_id);
        return {
          ...w,
          amount: Number(w.amount),
          telegram_id: u?.telegram_id,
          user_handle: u?.username ? `@${u.username}` : u?.first_name || String(u?.telegram_id || ''),
        };
      }),
    });
  }

  const wdActionMatch = apiPath.match(/^\/admin\/withdrawals\/([^/]+)\/action$/);
  if (wdActionMatch && method === 'POST') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    if (admin.adminRole === 'moderator') {
      return jsonResponse({ error: 'FORBIDDEN_ROLE', message: 'Moderators cannot process withdrawals.' }, 403);
    }
    const body = await readJson<{ action?: string; payoutTxHash?: string; adminNote?: string }>();
    const action = body.action;
    if (!action || !['approve', 'reject', 'mark_paid'].includes(action)) {
      return jsonResponse({ error: 'INVALID_ACTION', message: 'Invalid action.' }, 400);
    }

    const { data: w } = await sb.from('withdrawals').select('*').eq('id', wdActionMatch[1]).single();
    if (!w) return jsonResponse({ error: 'NOT_FOUND', message: 'Withdrawal not found.' }, 404);
    const { data: user } = await sb.from('users').select('*').eq('id', w.user_id).single();
    if (!user) return jsonResponse({ error: 'NOT_FOUND', message: 'User not found.' }, 404);

    const amt = Number(w.amount);
    const now = new Date().toISOString();

    if (action === 'approve') {
      const { data, error } = await sb
        .from('withdrawals')
        .update({ status: 'Approved', admin_note: safeText(body.adminNote, 200) || null, reviewed_at: now, updated_at: now })
        .eq('id', w.id)
        .select('*')
        .single();
      if (error) return jsonResponse({ error: 'ACTION_ERROR', message: error.message }, 400);
      return jsonResponse({ withdrawal: { ...data, amount: Number(data.amount) } });
    }

    if (action === 'reject') {
      await sb
        .from('users')
        .update({
          available_balance: Number((Number(user.available_balance) + amt).toFixed(6)),
          pending_balance: Math.max(0, Number((Number(user.pending_balance) - amt).toFixed(6))),
        })
        .eq('id', user.id);
      const { data, error } = await sb
        .from('withdrawals')
        .update({ status: 'Rejected', admin_note: safeText(body.adminNote, 200) || 'Rejected', reviewed_at: now, updated_at: now })
        .eq('id', w.id)
        .select('*')
        .single();
      if (error) return jsonResponse({ error: 'ACTION_ERROR', message: error.message }, 400);
      await sb.from('transactions').insert({
        user_id: user.id,
        tx_type: 'withdrawal_refund',
        amount: amt,
        currency: 'LOVA',
        description: 'Withdrawal rejected & refunded',
        is_demo: false,
      });
      return jsonResponse({ withdrawal: { ...data, amount: Number(data.amount) } });
    }

    // mark_paid
    const cleanHash = safeText(body.payoutTxHash, 256);
    if (!cleanHash || cleanHash.length < 16) {
      return jsonResponse({ error: 'PAYOUT_HASH_REQUIRED', message: 'Finalized TON payout TX hash required.' }, 400);
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (cfg.tonApiKey) headers.Authorization = `Bearer ${cfg.tonApiKey}`;
    const txRes = await fetch(`${cfg.tonApiEndpoint}/blockchain/transactions/${encodeURIComponent(cleanHash)}`, { headers });
    if (!txRes.ok) {
      return jsonResponse({ error: 'PAYOUT_TX_NOT_VERIFIED', message: `Payout TX not confirmed on TON (${txRes.status}).` }, 422);
    }
    const tx = (await txRes.json()) as { hash?: string; success?: boolean; aborted?: boolean };
    if (tx.aborted || tx.success === false) {
      return jsonResponse({ error: 'PAYOUT_TX_NOT_VERIFIED', message: 'Payout TX failed on-chain.' }, 422);
    }
    const finalHash = tx.hash || cleanHash;

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
        payout_tx_hash: finalHash,
        admin_note: safeText(body.adminNote, 200) || null,
        reviewed_at: w.reviewed_at || now,
        paid_at: now,
        updated_at: now,
      })
      .eq('id', w.id)
      .select('*')
      .single();
    if (error) return jsonResponse({ error: 'ACTION_ERROR', message: error.message }, 400);

    await sb.from('transactions').insert({
      user_id: user.id,
      tx_type: 'withdrawal_paid',
      amount: amt,
      currency: 'LOVA',
      chain_tx_hash: finalHash,
      description: `Withdrawal paid on TON (${finalHash.slice(0, 10)}...)`,
      is_demo: false,
    });
    return jsonResponse({ withdrawal: { ...data, amount: Number(data.amount) } });
  }

  if (apiPath === '/admin/wallets' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const [{ data: wallets }, { data: verifications }, { data: users }] = await Promise.all([
      sb.from('user_wallets').select('*').order('updated_at', { ascending: false }).limit(100),
      sb.from('wallet_verifications').select('*').order('created_at', { ascending: false }).limit(100),
      sb.from('users').select('id,telegram_id,username'),
    ]);
    const uMap = new Map((users || []).map((u) => [u.id, u]));
    return jsonResponse({
      wallets: (wallets || []).map((w) => ({
        ...w,
        telegram_id: uMap.get(w.user_id)?.telegram_id,
        username: uMap.get(w.user_id)?.username,
      })),
      verifications: verifications || [],
    });
  }

  const walletSuspendMatch = apiPath.match(/^\/admin\/wallets\/([^/]+)\/suspend$/);
  if (walletSuspendMatch && method === 'POST') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const body = await readJson<{ suspended?: boolean }>();
    const { data, error } = await sb
      .from('user_wallets')
      .update({ is_suspended: Boolean(body.suspended), updated_at: new Date().toISOString() })
      .eq('id', walletSuspendMatch[1])
      .select('*')
      .single();
    if (error) return jsonResponse({ error: 'WALLET_SUSPEND_ERROR', message: error.message }, 400);
    return jsonResponse({ wallet: data });
  }

  // ADMIN LEVEL UPGRADE VERIFICATION & MEMBERSHIP TIER MANAGEMENT
  if (apiPath === '/admin/level-upgrades' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const [{ settings }, levels, { data: rows }, { data: users }] = await Promise.all([
      getSettings(),
      getMembershipLevels(true),
      sb.from('level_upgrade_requests').select('*').order('created_at', { ascending: false }).limit(150),
      sb.from('users').select('id,telegram_id,username,first_name'),
    ]);
    const tonCfg = resolveTonConfig(cfg, settings);
    const levelNameMap = new Map(levels.map((l) => [l.level_number, l.name]));
    const userMap = new Map((users || []).map((u) => [u.id, u]));
    return jsonResponse({
      requests: (rows || []).map((r) => {
        const u = userMap.get(r.user_id);
        return {
          ...normalizeLevelUpgradeRow(r),
          target_level_name: levelNameMap.get(Number(r.target_level)) || `Level ${r.target_level}`,
          telegram_id: u?.telegram_id,
          user_handle: u?.username ? `@${u.username}` : u?.first_name || String(u?.telegram_id || ''),
        };
      }),
      levels,
      adminLovaWalletAddress: tonCfg.adminLovaWallet,
    });
  }

  const levelUpgradeActionMatch = apiPath.match(/^\/admin\/level-upgrades\/([^/]+)\/action$/);
  if (levelUpgradeActionMatch && method === 'POST') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    if (admin.adminRole === 'moderator') {
      return jsonResponse({ error: 'FORBIDDEN_ROLE', message: 'Moderators cannot review level upgrades.' }, 403);
    }
    const body = await readJson<{ action?: string; adminNote?: string }>();
    if (body.action !== 'approve' && body.action !== 'reject') {
      return jsonResponse({ error: 'INVALID_ACTION', message: 'Action must be approve or reject.' }, 400);
    }
    const { data: reqRow } = await sb
      .from('level_upgrade_requests')
      .select('*')
      .eq('id', levelUpgradeActionMatch[1])
      .single();
    if (!reqRow) return jsonResponse({ error: 'NOT_FOUND', message: 'Level upgrade request not found.' }, 404);
    if (reqRow.status !== 'Pending') {
      return jsonResponse({ error: 'ALREADY_PROCESSED', message: `Request already ${reqRow.status}.` }, 400);
    }
    const { data: userRow } = await sb.from('users').select('*').eq('id', reqRow.user_id).single();
    if (!userRow) return jsonResponse({ error: 'USER_NOT_FOUND', message: 'User not found.' }, 404);

    const now = new Date().toISOString();
    const adminNote = safeText(body.adminNote, 240) || null;
    const nextStatus = body.action === 'approve' ? 'Approved' : 'Rejected';
    const { data: updatedReq, error: updReqErr } = await sb
      .from('level_upgrade_requests')
      .update({
        status: nextStatus,
        admin_note: adminNote || (body.action === 'reject' ? 'Payment could not be verified' : null),
        reviewed_by_admin_id: admin.adminId || 'admin',
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', reqRow.id)
      .eq('status', 'Pending')
      .select('*')
      .single();
    if (updReqErr || !updatedReq) {
      return jsonResponse({ error: 'ACTION_ERROR', message: 'Request already reviewed or failed.' }, 400);
    }

    let updatedUser = normalizeUser(userRow);
    if (body.action === 'approve') {
      const nextLevel = Math.max(Number(userRow.membership_level || 1), Number(reqRow.target_level));
      const { data: uUpd, error: uErr } = await sb
        .from('users')
        .update({ membership_level: nextLevel, membership_updated_at: now, updated_at: now })
        .eq('id', userRow.id)
        .select('*')
        .single();
      if (uErr || !uUpd) return jsonResponse({ error: 'USER_UPGRADE_ERROR', message: 'Failed to upgrade level.' }, 400);
      updatedUser = normalizeUser(uUpd);
    }

    await sb.from('admin_audit_logs').insert({
      admin_id: admin.adminId || 'admin',
      admin_role: admin.adminRole || 'super_admin',
      action: body.action === 'approve' ? 'LEVEL_UPGRADE_APPROVED' : 'LEVEL_UPGRADE_REJECTED',
      target_type: 'level_upgrade_request',
      target_id: reqRow.id,
      details: {
        user_id: updatedUser.id,
        from_level: reqRow.from_level,
        target_level: reqRow.target_level,
        required_lova_amount: reqRow.required_lova_amount,
        tx_hash: reqRow.tx_hash,
        adminNote,
      },
    });

    return jsonResponse({ request: normalizeLevelUpgradeRow(updatedReq), user: updatedUser });
  }

  if (apiPath === '/admin/levels' && method === 'POST') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    if (admin.adminRole === 'moderator') {
      return jsonResponse({ error: 'FORBIDDEN_ROLE', message: 'Moderators cannot edit membership tiers.' }, 403);
    }
    const body = await readJson<Partial<MembershipLevel>>();
    const levelNumber = Number(body.level_number);
    if (!Number.isInteger(levelNumber) || levelNumber < 1 || levelNumber > 20) {
      return jsonResponse({ error: 'INVALID_LEVEL', message: 'Valid level_number (1-20) required.' }, 400);
    }
    const existing = await getMembershipLevelByNumber(levelNumber);
    const updatedRow: MembershipLevel = {
      level_number: levelNumber,
      name: (typeof body.name === 'string' ? body.name : existing.name).trim().slice(0, 60) || `Level ${levelNumber}`,
      badge_label: (typeof body.badge_label === 'string' ? body.badge_label : existing.badge_label).trim().slice(0, 20) || `LVL ${levelNumber}`,
      required_lova_amount: levelNumber === 1 ? 0 : Math.max(1, Number(body.required_lova_amount ?? existing.required_lova_amount)),
      mining_multiplier: Math.max(1, Number(body.mining_multiplier ?? existing.mining_multiplier)),
      daily_bonus_multiplier: Math.max(1, Number(body.daily_bonus_multiplier ?? existing.daily_bonus_multiplier)),
      benefits: Array.isArray(body.benefits) ? body.benefits.map((b) => String(b).trim()).filter(Boolean).slice(0, 8) : existing.benefits,
      is_active: levelNumber === 1 ? true : (typeof body.is_active === 'boolean' ? body.is_active : existing.is_active),
    };
    const { data, error } = await sb
      .from('membership_levels')
      .upsert({ ...updatedRow, updated_at: new Date().toISOString() }, { onConflict: 'level_number' })
      .select('*')
      .single();
    if (error) return jsonResponse({ error: 'LEVEL_SAVE_ERROR', message: error.message }, 400);
    return jsonResponse({ level: normalizeMembershipLevelRow(data) });
  }

  if (apiPath === '/admin/tasks' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const tasks = await getTasksForUser('00000000-0000-0000-0000-000000000000', true);
    return jsonResponse({ tasks });
  }

  if (apiPath === '/admin/tasks' && method === 'POST') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const t = await readJson<Partial<TaskItem> & { id?: string }>();
    const payload = {
      title: String(t.title || 'New Task').trim().slice(0, 120),
      description: String(t.description || '').trim().slice(0, 500),
      category: t.category || 'custom',
      reward_amount: Math.max(0.01, Number(t.reward_amount || 50)),
      action_url: t.action_url?.trim() || null,
      telegram_chat_id: t.telegram_chat_id?.trim() || null,
      required_count: Math.max(1, Number(t.required_count || 1)),
      verification_code: t.verification_code?.trim() || null,
      is_active: t.is_active ?? true,
      sort_order: Number(t.sort_order ?? 10),
    };
    const q = t.id
      ? sb.from('tasks').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', t.id).select('*').single()
      : sb.from('tasks').insert(payload).select('*').single();
    const { data, error } = await q;
    if (error) return jsonResponse({ error: 'TASK_SAVE_ERROR', message: error.message }, 400);
    return jsonResponse({ task: { ...data, reward_amount: Number(data.reward_amount) } });
  }

  const taskDelMatch = apiPath.match(/^\/admin\/tasks\/([^/]+)$/);
  if (taskDelMatch && method === 'DELETE') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    await sb.from('tasks').delete().eq('id', taskDelMatch[1]);
    return jsonResponse({ ok: true });
  }

  if (apiPath === '/admin/announcements' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const { data } = await sb.from('announcements').select('*').order('created_at', { ascending: false });
    return jsonResponse({ announcements: data || [] });
  }

  if (apiPath === '/admin/announcements' && method === 'POST') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const body = await readJson<{ title?: string; body?: string; category?: string }>();
    const title = safeText(body.title, 120);
    const msgBody = safeText(body.body, 600);
    if (!title || !msgBody) return jsonResponse({ error: 'INVALID_ANNOUNCEMENT', message: 'Title and body required.' }, 400);
    const { data, error } = await sb
      .from('announcements')
      .insert({
        title,
        body: msgBody,
        category: ['airdrop', 'update', 'maintenance', 'security'].includes(body.category || '') ? body.category : 'airdrop',
        is_active: true,
      })
      .select('*')
      .single();
    if (error) return jsonResponse({ error: 'ANNOUNCEMENT_ERROR', message: error.message }, 400);
    return jsonResponse({ announcement: data });
  }

  const annDelMatch = apiPath.match(/^\/admin\/announcements\/([^/]+)$/);
  if (annDelMatch && method === 'DELETE') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    await sb.from('announcements').delete().eq('id', annDelMatch[1]);
    return jsonResponse({ ok: true });
  }

  if (apiPath === '/admin/referrals' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const [{ data: refs }, { data: users }] = await Promise.all([
      sb.from('referrals').select('*').order('created_at', { ascending: false }).limit(100),
      sb.from('users').select('id,telegram_id,username'),
    ]);
    const uMap = new Map((users || []).map((u) => [u.id, u]));
    return jsonResponse({
      referrals: (refs || []).map((r) => ({
        ...r,
        referrer_handle: uMap.get(r.referrer_user_id)?.username || uMap.get(r.referrer_user_id)?.telegram_id,
        referred_handle: uMap.get(r.referred_user_id)?.username || uMap.get(r.referred_user_id)?.telegram_id,
      })),
    });
  }

  if (apiPath === '/admin/audit-logs' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const { data } = await sb.from('admin_audit_logs').select('*').order('created_at', { ascending: false }).limit(100);
    return jsonResponse({ logs: data || [] });
  }

  if (apiPath === '/admin/telegram/status' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const [me, wh, menu] = cfg.telegramBotToken
      ? await Promise.all([
          callTelegramApi(cfg, 'getMe'),
          callTelegramApi(cfg, 'getWebhookInfo'),
          callTelegramApi(cfg, 'getChatMenuButton'),
        ])
      : [null, null, null];
    return jsonResponse({
      configured: Boolean(cfg.telegramBotToken),
      bot: me?.ok ? me.result : null,
      webhook: wh?.ok ? wh.result : null,
      menuButton: menu?.ok ? menu.result : null,
      error: !cfg.telegramBotToken ? 'TELEGRAM_BOT_TOKEN is not set.' : null,
      detectedOrigin: cfg.appUrl,
    });
  }

  if (apiPath === '/admin/telegram/configure' && method === 'POST') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    if (!cfg.telegramBotToken) return jsonResponse({ error: 'TELEGRAM_BOT_TOKEN_MISSING', message: 'Set TELEGRAM_BOT_TOKEN.' }, 400);
    const body = await readJson<{ miniAppUrl?: string; registerWebhook?: boolean }>();
    const cleanUrl = safeText(body.miniAppUrl, 300).replace(/\/+$/, '');
    if (!cleanUrl.startsWith('https://')) return jsonResponse({ error: 'HTTPS_REQUIRED', message: 'HTTPS URL required.' }, 400);

    const [cmdRes, menuRes] = await Promise.all([
      callTelegramApi(cfg, 'setMyCommands', {
        commands: [
          { command: 'start', description: 'Open LOVA Mining Mini App' },
          { command: 'mine', description: 'Launch mining core & daily check-in' },
          { command: 'balance', description: 'View your live LOVA Balance on TON' },
          { command: 'referral', description: 'Get your referral invite link' },
          { command: 'help', description: 'LOVA Mining guide & support' },
        ],
      }),
      callTelegramApi(cfg, 'setChatMenuButton', {
        menu_button: { type: 'web_app', text: 'Launch LOVA', web_app: { url: cleanUrl } },
      }),
    ]);

    let whOk = true;
    let whDetail = 'Skipped';
    if (body.registerWebhook !== false) {
      const whRes = await callTelegramApi(cfg, 'setWebhook', {
        url: `${cleanUrl}/api/telegram/webhook`,
        secret_token: getWebhookSecret(cfg),
        allowed_updates: ['message', 'callback_query'],
      });
      whOk = whRes.ok;
      whDetail = whRes.ok ? `Webhook registered at ${cleanUrl}/api/telegram/webhook` : whRes.description || 'Failed';
    }

    const [me, wh, menu] = await Promise.all([
      callTelegramApi(cfg, 'getMe'),
      callTelegramApi(cfg, 'getWebhookInfo'),
      callTelegramApi(cfg, 'getChatMenuButton'),
    ]);

    return jsonResponse({
      ok: cmdRes.ok && menuRes.ok && whOk,
      steps: {
        commands: { ok: cmdRes.ok, detail: cmdRes.ok ? 'Synced' : cmdRes.description || 'Failed' },
        menuButton: { ok: menuRes.ok, detail: menuRes.ok ? 'Synced' : menuRes.description || 'Failed' },
        webhook: { ok: whOk, detail: whDetail },
      },
      status: {
        configured: true,
        bot: me.ok ? me.result : null,
        webhook: wh.ok ? wh.result : null,
        menuButton: menu.ok ? menu.result : null,
        error: null,
      },
    });
  }

  if (apiPath === '/admin/telegram/webhook-health' && method === 'POST') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const body = await readJson<{ url?: string }>();
    const target = safeText(body.url, 400) || `${cfg.appUrl}/api/telegram/webhook`;
    const started = Date.now();
    let getStatus: number | null = null;
    let postStatus: number | null = null;
    let redirectLocation: string | null = null;
    try {
      const gr = await fetch(target, { method: 'GET', redirect: 'manual' });
      getStatus = gr.status;
      if (getStatus >= 300 && getStatus < 400) redirectLocation = gr.headers.get('location');
    } catch {
      // ignore
    }
    try {
      const pr = await fetch(target, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: 0 }),
      });
      postStatus = pr.status;
      if (!redirectLocation && postStatus >= 300 && postStatus < 400) redirectLocation = pr.headers.get('location');
    } catch {
      // ignore
    }
    const reachable = getStatus !== null || postStatus !== null;
    const healthy = postStatus === 200 || postStatus === 403;
    return jsonResponse({
      url: target,
      checkedAt: new Date().toISOString(),
      reachable,
      healthy,
      latencyMs: Date.now() - started,
      getStatus,
      postStatus,
      redirectLocation,
      summary: healthy
        ? `Healthy — Endpoint responded with HTTP ${postStatus}.`
        : `Endpoint returned HTTP ${postStatus ?? getStatus ?? 'ERR'}.`,
      responsePreview: null,
    });
  }

  if (apiPath === '/admin/admins' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const { data } = await sb.from('admins').select('*').order('created_at', { ascending: false });
    return jsonResponse({ admins: data || [], envAdminTelegramIds: cfg.adminTelegramIds });
  }

  if (apiPath === '/admin/admins' && method === 'POST') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    if (admin.adminRole !== 'super_admin') {
      return jsonResponse({ error: 'FORBIDDEN_ROLE', message: 'Only super_admin can edit admins.' }, 403);
    }
    const body = await readJson<{ telegram_id?: number; display_name?: string; role?: AdminRole }>();
    const tgId = Number(body.telegram_id);
    if (!Number.isInteger(tgId) || tgId <= 0) {
      return jsonResponse({ error: 'INVALID_TELEGRAM_ID', message: 'Valid numeric Telegram ID required.' }, 400);
    }
    const { data, error } = await sb
      .from('admins')
      .upsert(
        {
          telegram_id: tgId,
          display_name: safeText(body.display_name, 80) || `Admin ${tgId}`,
          role: body.role || 'moderator',
          is_active: true,
        },
        { onConflict: 'telegram_id' }
      )
      .select('*')
      .single();
    if (error) return jsonResponse({ error: 'ADMIN_UPSERT_ERROR', message: error.message }, 400);
    return jsonResponse({ admin: data });
  }

  const adminToggleMatch = apiPath.match(/^\/admin\/admins\/([^/]+)\/toggle$/);
  if (adminToggleMatch && method === 'POST') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    if (admin.adminRole !== 'super_admin') {
      return jsonResponse({ error: 'FORBIDDEN_ROLE', message: 'Only super_admin can toggle admins.' }, 403);
    }
    const body = await readJson<{ is_active?: boolean }>();
    const { data, error } = await sb
      .from('admins')
      .update({ is_active: Boolean(body.is_active) })
      .eq('id', adminToggleMatch[1])
      .select('*')
      .single();
    if (error) return jsonResponse({ error: 'ADMIN_TOGGLE_ERROR', message: error.message }, 400);
    return jsonResponse({ admin: data });
  }

  if (apiPath === '/admin/schema-sql' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    return jsonResponse({ sql: SUPABASE_SCHEMA_SQL });
  }

  return jsonResponse({ error: 'API_NOT_FOUND', message: 'Unknown API endpoint.' }, 404);
}
