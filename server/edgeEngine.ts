import crypto from 'node:crypto';
import { Address } from '@ton/core';
import type { D1Database } from './d1Types.ts';
import { createD1Repository } from './db.ts';
import { D1_SCHEMA_SQL } from './schemaSql.ts';
import type {
  AdminRole,
  AppSettings,
  LovaUser,
  MembershipLevel,
  OnChainWalletBalances,
  PublicSystemStatus,
  UserStatus,
} from '../src/types/lova.ts';

export interface EdgeEnv {
  DB?: D1Database;
  APP_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_ALLOW_DEV_PREVIEW?: string;
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
    .createHmac('sha256', env.ADMIN_BOOTSTRAP_SECRET || botToken || 'lova-edge-fallback')
    .update('lova-edge-session-v1')
    .digest('hex');

  return {
    appUrl: (env.APP_URL || requestUrl.origin).trim().replace(/\/+$/, ''),
    telegramBotToken: botToken,
    telegramBotUsername: (env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@+/, '') || null,
    telegramWebhookSecret: (env.TELEGRAM_WEBHOOK_SECRET || '').trim() || null,
    telegramAllowDevPreview: env.TELEGRAM_ALLOW_DEV_PREVIEW === 'true',
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

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return h;
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

function resolvePublicAppUrl(rawAppUrl: string | undefined | null): string | null {
  const trimmed = (rawAppUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed.startsWith('https://')) return null;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (
      !host ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.endsWith('.run.app')
    ) {
      return null;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function buildSystemStatus(
  cfg: ParsedConfig,
  dbMode: PublicSystemStatus['databaseMode'],
  settings?: Partial<AppSettings> | null
): PublicSystemStatus {
  const ton = resolveTonConfig(cfg, settings);

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
    publicAppUrl: resolvePublicAppUrl(cfg.appUrl),
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
  if (request.method.toUpperCase() === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  return jsonResponse(
    {
      url: origin,
      name: 'LOVA Mining',
      iconUrl: `${origin}/icon.png`,
    },
    200,
    {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'public, max-age=300',
    }
  );
}

export async function handleApiRequest(request: Request, env: EdgeEnv): Promise<Response> {
  const url = new URL(request.url);
  const cfg = parseEnv(env, url);
  const isHttps = url.protocol === 'https:';
  const apiPath = url.pathname.replace(/^\/api/, '') || '/';
  const method = request.method.toUpperCase();
  const clientIp = request.headers.get('cf-connecting-ip') || null;

  if (apiPath === '/health' && method === 'GET') {
    return jsonResponse({
      ok: true,
      service: 'lova-mining-edge-api',
      runtime: 'cloudflare-d1',
      timestamp: new Date().toISOString(),
    });
  }

  const getBotUsername = async (): Promise<string | null> => {
    if (cfg.telegramBotUsername) return cfg.telegramBotUsername;
    if (!cfg.telegramBotToken) return null;
    const me = await callTelegramApi<{ username?: string }>(cfg, 'getMe').catch(() => null);
    return me?.ok && me.result?.username ? me.result.username.replace(/^@+/, '') : null;
  };

  if (!env.DB) {
    if (apiPath === '/system/public' && method === 'GET') {
      const botUsername = await getBotUsername();
      const status = buildSystemStatus(cfg, 'd1_not_bound', null);
      if (botUsername) status.telegramBotUsername = botUsername;
      return jsonResponse({
        systemStatus: status,
        botUsername: status.telegramBotUsername,
        appName: 'LOVA Mining',
      });
    }
    return jsonResponse(
      {
        error: 'D1_NOT_BOUND',
        message:
          'Cloudflare D1 binding "DB" is not configured. Bind your D1 database in wrangler.toml / Cloudflare Pages & Workers Settings and execute schema.sql.',
      },
      503
    );
  }

  const repo = createD1Repository(env.DB);
  const schemaReady = await repo.checkSchemaReady();

  const readJson = async <T = Record<string, unknown>>(): Promise<T> => {
    return (await request.json().catch(() => ({}))) as T;
  };

  // Public System Status (always accessible so setup banner can guide admin if schema not yet applied)
  if (apiPath === '/system/public' && method === 'GET') {
    const [settings, botUsername] = await Promise.all([
      schemaReady ? repo.getSettings() : Promise.resolve(null),
      getBotUsername(),
    ]);
    const status = buildSystemStatus(cfg, schemaReady ? 'd1' : 'd1_needs_schema', settings);
    if (botUsername) status.telegramBotUsername = botUsername;
    return jsonResponse({
      systemStatus: status,
      botUsername: status.telegramBotUsername,
      appName: settings?.app_name || 'LOVA Mining',
    });
  }

  // Telegram Webhook (can respond to /start, /mine, /help even before DB schema if needed)
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
      tokenFormatValid: /^\d+:[A-Za-z0-9_-]{20,}$/.test(cfg.telegramBotToken),
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
        const refNote = arg.startsWith('ref_')
          ? '\n\nReferral invite detected and attached to your session.'
          : '';
        await sendMsg(
          `<b>Welcome to LOVA Mining${firstName}!</b>\nMine Today, Earn Tomorrow.\n\nTap below to launch LOVA Mining, earn LOVA on TON, and complete 0.05 GRAM KYC verification.${refNote}`,
          launch,
          '🚀 Launch LOVA Mining'
        );
      } else if (cmd === '/mine') {
        await sendMsg(
          '<b>LOVA Mining Core</b>\nStart or claim your server-verified mining session and daily streak bonus inside the Mini App.',
          cfg.appUrl,
          '⚡ Open Mining Core'
        );
      } else if (cmd === '/balance') {
        const tgId = msg.from?.id;
        const u = tgId && schemaReady ? await repo.getUserByTelegramId(tgId).catch(() => null) : null;
        if (u) {
          await sendMsg(
            `<b>Your Live LOVA Account (TON Network)</b>\nAvailable: <code>${u.available_balance.toFixed(
              4
            )} LOVA</code>\nPending Withdrawal: <code>${u.pending_balance.toFixed(
              2
            )} LOVA</code>\nTotal Earned: <code>${u.total_earned.toFixed(
              4
            )} LOVA</code>\nDaily Streak: <b>${u.streak_days} days</b>`,
            cfg.appUrl,
            '💼 Open Wallet & Mining'
          );
        } else {
          await sendMsg('Open the LOVA Mini App to initialize your miner profile.', cfg.appUrl, '🚀 Initialize Account');
        }
      } else if (cmd === '/referral') {
        const tgId = msg.from?.id;
        const u = tgId && schemaReady ? await repo.getUserByTelegramId(tgId).catch(() => null) : null;
        const botName = await getBotUsername();
        const refLink = u
          ? botName
            ? `https://t.me/${botName}?startapp=ref_${u.referral_code}`
            : `${cfg.appUrl}/?ref=${u.referral_code}`
          : cfg.appUrl;
        await sendMsg(
          `<b>Your LOVA Referral Link</b>\n<code>${refLink}</code>\n\nShare this link to earn multi-level LOVA referral bonuses when friends join and mine.`,
          cfg.appUrl,
          '👥 Invite Friends'
        );
      } else if (cmd === '/help') {
        await sendMsg(
          `<b>LOVA Mining Commands</b>\n/start — Launch LOVA Mining Mini App\n/mine — Open Mining Core\n/balance — Check Live LOVA Balance\n/referral — Get your invite link\n/help — Show this guide`,
          cfg.appUrl,
          '🚀 Open LOVA Mining'
        );
      } else if (msg.chat.type === 'private') {
        await sendMsg(
          `<b>LOVA Mining</b> — Mine Today, Earn Tomorrow.\n\nUse /start, /mine, /balance, or /referral, or tap the button below to launch the Mini App.`,
          cfg.appUrl
        );
      }
    }
    return jsonResponse({ ok: true });
  }

  // Allow admin schema endpoint & admin login even if schema needs setup so admins can copy schema.sql
  if (!schemaReady && !apiPath.startsWith('/admin')) {
    return jsonResponse(
      {
        error: 'D1_SCHEMA_MISSING',
        message:
          'Cloudflare D1 database is bound, but schema tables are not initialized yet. Run: npx wrangler d1 execute lova-mining-db --remote --file=./schema.sql',
      },
      503
    );
  }

  // Auth Helpers
  const getAuthedUser = async (): Promise<{ user: LovaUser; claims: SessionClaims } | Response> => {
    const token = extractBearerOrCookie(request, SESSION_COOKIE, 'authorization');
    const claims = verifySessionToken(token, cfg.sessionSecret);
    if (!claims || claims.kind !== 'user') {
      return jsonResponse({ error: 'UNAUTHORIZED', message: 'Valid session required.' }, 401);
    }
    const user = await repo.getUserById(claims.sub);
    if (!user) {
      return jsonResponse({ error: 'USER_NOT_FOUND', message: 'User account not found.' }, 401);
    }
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

  const buildBootstrap = async (user: LovaUser) => {
    const [activeSession, activeWallet, settings, announcements, botName, membershipLevels] =
      await Promise.all([
        repo.getActiveOrExpiredSession(user.id),
        repo.getActiveWallet(user.id),
        repo.getSettings(),
        repo.getAnnouncements(false),
        getBotUsername(),
        repo.getMembershipLevels(false),
      ]);

    const status = buildSystemStatus(cfg, 'd1', settings);
    if (botName) status.telegramBotUsername = botName;
    const todayUtc = new Date().toISOString().slice(0, 10);
    const currentLevelNum = user.membership_level || 1;
    const currentMembership =
      membershipLevels.find((l) => l.level_number === currentLevelNum) || membershipLevels[0];

    return {
      user,
      activeSession,
      activeWallet,
      settings,
      announcements,
      systemStatus: status,
      membershipLevels,
      currentMembership,
      serverTime: new Date().toISOString(),
      canCheckInToday: user.last_checkin_date !== todayUtc,
    };
  };

  // ============================================================================
  // AUTH ROUTES
  // ============================================================================
  if (apiPath === '/auth/telegram' && method === 'POST') {
    try {
      const body = await readJson<{ initData?: string; startParam?: string; previewSlot?: string }>();
      const initData = typeof body.initData === 'string' ? body.initData : '';
      const refParam = safeText(body.startParam, 64) || null;
      const previewSlot = safeText(body.previewSlot, 32);

      let tgUser: {
        id: number;
        username?: string;
        first_name?: string;
        last_name?: string;
        photo_url?: string;
      } | null = null;
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
        if (claims && claims.kind === 'user' && !previewSlot) {
          const existingUser = await repo.getUserById(claims.sub);
          if (existingUser) {
            tgUser = {
              id: existingUser.telegram_id,
              username: existingUser.username || 'lova_preview_miner',
              first_name: existingUser.first_name || 'Preview',
              last_name: existingUser.last_name || 'Miner',
            };
          }
        }
        if (!tgUser) {
          const baseId = previewSlot
            ? 900000000 + (Math.abs(hashString(previewSlot)) % 99999)
            : 900100001;
          tgUser = {
            id: baseId,
            username: previewSlot ? `miner_${previewSlot.slice(0, 8)}` : 'lova_preview_miner',
            first_name: 'LOVA',
            last_name: 'Preview Miner',
          };
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

      const { user } = await repo.upsertTelegramUser({
        telegram_id: tgUser.id,
        username: tgUser.username || null,
        first_name: tgUser.first_name || null,
        last_name: tgUser.last_name || null,
        photo_url: tgUser.photo_url || null,
        referralCodeParam: startParam,
      });

      if (user.status === 'banned') {
        return jsonResponse({ error: 'ACCOUNT_BANNED', message: user.ban_reason || 'Account banned.' }, 403);
      }

      const token = signSessionToken({ sub: user.id, tgId: user.telegram_id, kind: 'user' }, cfg.sessionSecret);
      const payload = await buildBootstrap(user);
      return jsonResponse({ sessionToken: token, ...payload }, 200, {
        'Set-Cookie': buildCookieHeader(SESSION_COOKIE, token, 60 * 60 * 24 * 7, isHttps),
      });
    } catch (err) {
      return jsonResponse(
        { error: 'AUTH_ERROR', message: err instanceof Error ? err.message : 'Authentication failed.' },
        500
      );
    }
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

  // ============================================================================
  // MINING ROUTES
  // ============================================================================
  if (apiPath === '/mining/start' && method === 'POST') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    if (auth.user.status !== 'active') {
      return jsonResponse({ error: 'ACCOUNT_SUSPENDED', message: 'Your account is suspended from mining.' }, 403);
    }
    const settings = await repo.getSettings();
    if (settings.maintenance_mode || settings.emergency_pause || !settings.mining_enabled) {
      return jsonResponse({ error: 'MINING_PAUSED', message: 'Mining is currently paused by platform administrators.' }, 403);
    }
    const existing = await repo.getActiveOrExpiredSession(auth.user.id);
    if (existing) {
      return jsonResponse(
        {
          error: 'SESSION_EXISTS',
          message:
            existing.status === 'expired'
              ? 'Your completed mining session has rewards ready to claim first.'
              : 'A mining session is already active.',
          activeSession: existing,
        },
        409
      );
    }
    const userLevel = await repo.getMembershipLevelByNumber(auth.user.membership_level || 1);
    const session = await repo.startMiningSession(auth.user.id, settings, userLevel.mining_multiplier);
    return jsonResponse({ session, serverTime: new Date().toISOString() });
  }

  if ((apiPath === '/mining/stop' || apiPath === '/mining/claim') && method === 'POST') {
    try {
      const action = apiPath === '/mining/stop' ? 'stop' : 'claim';
      const auth = await getAuthedUser();
      if (auth instanceof Response) return auth;
      const settings = await repo.getSettings();
      if (action === 'claim' && (settings.maintenance_mode || settings.emergency_pause)) {
        return jsonResponse({ error: 'SYSTEM_PAUSED', message: 'Claims are temporarily paused.' }, 403);
      }
      const existing = await repo.getActiveOrExpiredSession(auth.user.id);
      if (!existing) {
        return jsonResponse(
          { error: 'NO_SESSION', message: 'No active or completed mining session found.' },
          404
        );
      }
      const result = await repo.settleMiningSession(existing, action, settings);
      const updatedUser = (await repo.getUserById(auth.user.id))!;
      return jsonResponse({
        ...result,
        user: updatedUser,
        serverTime: new Date().toISOString(),
      });
    } catch (err) {
      return jsonResponse({ error: 'MINING_SETTLE_ERROR', message: (err as Error).message }, 400);
    }
  }

  if (apiPath === '/mining/history' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const history = await repo.getMiningHistory(auth.user.id);
    return jsonResponse(history);
  }

  // ============================================================================
  // DAILY CHECK-IN
  // ============================================================================
  if (apiPath === '/checkin' && method === 'POST') {
    try {
      const auth = await getAuthedUser();
      if (auth instanceof Response) return auth;
      const settings = await repo.getSettings();
      if (settings.maintenance_mode || settings.emergency_pause) {
        return jsonResponse({ error: 'SYSTEM_PAUSED', message: 'Platform is temporarily paused.' }, 403);
      }
      const userLevel = await repo.getMembershipLevelByNumber(auth.user.membership_level || 1);
      const result = await repo.performDailyCheckin(
        auth.user,
        settings,
        userLevel.daily_bonus_multiplier
      );
      return jsonResponse(result);
    } catch (err) {
      return jsonResponse({ error: 'CHECKIN_ERROR', message: (err as Error).message }, 400);
    }
  }

  // ============================================================================
  // MEMBERSHIP LEVEL UP SYSTEM
  // ============================================================================
  if (apiPath === '/levels' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const [levels, requests, settings] = await Promise.all([
      repo.getMembershipLevels(false),
      repo.getUserLevelUpgradeRequests(auth.user.id),
      repo.getSettings(),
    ]);
    const tonCfg = resolveTonConfig(cfg, settings);
    const currentLevel = auth.user.membership_level || 1;
    const currentMembership = levels.find((l) => l.level_number === currentLevel) || levels[0];
    return jsonResponse({
      currentLevel,
      currentMembership,
      levels,
      requests,
      adminLovaWalletAddress: tonCfg.adminLovaWallet,
      lovaJettonMasterAddress: tonCfg.lovaMaster,
    });
  }

  if (apiPath === '/levels/upgrade-request' && method === 'POST') {
    try {
      const auth = await getAuthedUser();
      if (auth instanceof Response) return auth;
      const settings = await repo.getSettings();
      if (settings.maintenance_mode || settings.emergency_pause) {
        return jsonResponse(
          { error: 'SYSTEM_PAUSED', message: 'Level upgrades are temporarily paused by administrators.' },
          403
        );
      }
      const tonCfg = resolveTonConfig(cfg, settings);
      if (!tonCfg.adminLovaWallet) {
        return jsonResponse(
          {
            error: 'ADMIN_LOVA_WALLET_NOT_CONFIGURED',
            message: 'Official Admin LOVA wallet address is not configured yet. Ask an administrator to set it in Admin Settings.',
          },
          503
        );
      }

      const body = await readJson<{ targetLevel?: number; txHash?: string; senderWalletAddress?: string }>();
      const targetLevel = Number(body.targetLevel);
      if (!Number.isInteger(targetLevel) || targetLevel < 2) {
        return jsonResponse(
          { error: 'INVALID_TARGET_LEVEL', message: 'Select a valid membership level above your current tier.' },
          400
        );
      }

      const txHash = safeText(body.txHash, 256);
      if (!txHash || txHash.length < 16) {
        return jsonResponse(
          { error: 'MISSING_TX_HASH', message: 'Enter the external TON payment transaction hash (TXID) after sending LOVA.' },
          400
        );
      }

      let senderWalletAddress: string | null = null;
      const rawSender = safeText(body.senderWalletAddress, 128);
      if (rawSender) {
        const normSender = normalizeTonAddress(rawSender);
        if (!normSender) {
          return jsonResponse({ error: 'INVALID_SENDER_WALLET', message: 'Sender TON wallet address format is invalid.' }, 400);
        }
        senderWalletAddress = normSender.friendly;
      } else {
        const activeWallet = await repo.getActiveWallet(auth.user.id);
        senderWalletAddress = activeWallet?.wallet_address || null;
      }

      const requestRecord = await repo.submitLevelUpgradeRequest({
        user: auth.user,
        targetLevel,
        txHash,
        senderWalletAddress,
        adminWalletAddress: tonCfg.adminLovaWallet,
      });

      return jsonResponse({ request: requestRecord });
    } catch (err) {
      return jsonResponse({ error: 'LEVEL_UPGRADE_REQUEST_ERROR', message: (err as Error).message }, 400);
    }
  }

  // ============================================================================
  // TASKS
  // ============================================================================
  if (apiPath === '/tasks' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const [tasks, stats] = await Promise.all([
      repo.getTasksForUser(auth.user.id, false),
      repo.getUserStatsForVerification(auth.user.id),
    ]);
    return jsonResponse({ tasks, stats });
  }

  const taskStartMatch = apiPath.match(/^\/tasks\/([^/]+)\/start$/);
  if (taskStartMatch && method === 'POST') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const task = await repo.getTaskById(taskStartMatch[1]);
    if (!task || !task.is_active) {
      return jsonResponse({ error: 'TASK_NOT_FOUND', message: 'Task not found or inactive.' }, 404);
    }
    const completion = await repo.startTask(auth.user.id, task.id);
    return jsonResponse({ ok: true, completion });
  }

  const taskVerifyMatch = apiPath.match(/^\/tasks\/([^/]+)\/verify$/);
  if (taskVerifyMatch && method === 'POST') {
    try {
      const auth = await getAuthedUser();
      if (auth instanceof Response) return auth;
      const task = await repo.getTaskById(taskVerifyMatch[1]);
      if (!task || !task.is_active) {
        return jsonResponse({ error: 'TASK_NOT_FOUND', message: 'Task not found or inactive.' }, 404);
      }

      const userTasks = await repo.getTasksForUser(auth.user.id, true);
      const currentTaskState = userTasks.find((t) => t.id === task.id);
      if (currentTaskState?.user_status === 'completed') {
        return jsonResponse({ error: 'ALREADY_COMPLETED', message: 'You have already claimed this task.' }, 409);
      }

      const stats = await repo.getUserStatsForVerification(auth.user.id);
      if (task.category === 'wallet_verified') {
        if (!stats.hasVerifiedWallet) {
          return jsonResponse(
            {
              error: 'WALLET_NOT_VERIFIED',
              message: 'Connect a TON wallet and complete the 0.05 GRAM verification fee first.',
            },
            422
          );
        }
      } else if (task.category === 'referral_milestone') {
        if (stats.referralCount < task.required_count) {
          return jsonResponse(
            {
              error: 'MILESTONE_NOT_MET',
              message: `You have ${stats.referralCount} of ${task.required_count} required referrals.`,
            },
            422
          );
        }
      } else if (task.category === 'mining_sessions') {
        if (stats.completedMiningSessions < task.required_count) {
          return jsonResponse(
            {
              error: 'MILESTONE_NOT_MET',
              message: `You have completed ${stats.completedMiningSessions} of ${task.required_count} required mining sessions.`,
            },
            422
          );
        }
      } else if (task.category === 'telegram_channel') {
        if (!cfg.telegramBotToken || !task.telegram_chat_id) {
          return jsonResponse(
            {
              error: 'TELEGRAM_BOT_NOT_CONFIGURED',
              message: 'Telegram channel verification requires TELEGRAM_BOT_TOKEN and a channel ID.',
            },
            422
          );
        }
        const mRes = await fetch(
          `https://api.telegram.org/bot${cfg.telegramBotToken}/getChatMember?chat_id=${encodeURIComponent(
            task.telegram_chat_id
          )}&user_id=${auth.user.telegram_id}`
        );
        const mJson = (await mRes.json()) as { ok?: boolean; result?: { status?: string } };
        if (!mJson.ok || !['member', 'administrator', 'creator'].includes(mJson.result?.status || '')) {
          return jsonResponse(
            { error: 'NOT_CHANNEL_MEMBER', message: 'You are not a verified member of the required Telegram channel yet.' },
            422
          );
        }
      } else {
        if (task.action_url) {
          if (!currentTaskState?.started_at) {
            return jsonResponse(
              { error: 'TASK_NOT_STARTED', message: 'Please open the task / ad link first before verifying.' },
              422
            );
          }
          const minDwellMs = task.category === 'ads_code' ? 5_000 : 10_000;
          const elapsedMs = Date.now() - new Date(currentTaskState.started_at).getTime();
          if (elapsedMs < minDwellMs) {
            return jsonResponse(
              {
                error: 'VERIFICATION_DWELL_REQUIRED',
                message: `Please complete the task action first (${Math.ceil((minDwellMs - elapsedMs) / 1000)}s remaining).`,
              },
              422
            );
          }
        }
        if (task.verification_code) {
          const body = await readJson<{ code?: string }>();
          const submitted = safeText(body.code, 64);
          if (!submitted) {
            return jsonResponse({ error: 'CODE_REQUIRED', message: 'Enter the Ads / Task verification code.' }, 422);
          }
          if (submitted.toLowerCase() !== task.verification_code.trim().toLowerCase()) {
            return jsonResponse({ error: 'INVALID_VERIFICATION_CODE', message: 'Verification code does not match.' }, 422);
          }
        } else if (!task.action_url) {
          return jsonResponse(
            {
              error: 'TASK_MISCONFIGURED',
              message: 'This task requires either a task link or a verification code configured by an admin.',
            },
            422
          );
        }
      }

      const updatedUser = await repo.completeTask(auth.user.id, task, { verifiedAt: new Date().toISOString() });
      const tasks = await repo.getTasksForUser(auth.user.id, false);
      return jsonResponse({ user: updatedUser, tasks, awarded: task.reward_amount });
    } catch (err) {
      return jsonResponse({ error: 'TASK_VERIFY_ERROR', message: (err as Error).message }, 400);
    }
  }

  // ============================================================================
  // REFERRALS & LEADERBOARD
  // ============================================================================
  if (apiPath === '/referrals' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const [settings, data, botName] = await Promise.all([
      repo.getSettings(),
      repo.getReferralDashboard(auth.user.id),
      getBotUsername(),
    ]);
    return jsonResponse({
      referralCode: auth.user.referral_code,
      telegramInviteUrl: botName ? `https://t.me/${botName}?startapp=ref_${auth.user.referral_code}` : null,
      webInviteUrl: `${cfg.appUrl}/?ref=${auth.user.referral_code}`,
      config: {
        l1FixedBonus: settings.referral_l1_fixed_bonus,
        l1Percent: settings.referral_l1_percent,
        l2Percent: settings.referral_l2_percent,
      },
      ...data,
    });
  }

  if (apiPath === '/leaderboard' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const tab = url.searchParams.get('tab') === 'referrals' ? 'referrals' : 'miners';
    const rawPeriod = url.searchParams.get('period');
    const period = rawPeriod === 'weekly' ? 'weekly' : rawPeriod === 'monthly' ? 'monthly' : 'all';

    const [entries, overview] = await Promise.all([
      repo.getLeaderboard(tab, period),
      repo.getAdminOverview(),
    ]);

    return jsonResponse({
      tab,
      period,
      entries,
      platformStats: {
        totalMiners: overview.totalUsers,
        totalMiningRewards: overview.totalMiningRewards,
        totalReferrals: overview.totalReferrals,
      },
    });
  }

  // ============================================================================
  // WALLET & 0.05 GRAM KYC VERIFICATION
  // ============================================================================
  if (apiPath === '/wallet/connect' && method === 'POST') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const body = await readJson<{ address?: string; provider?: string }>();
    const norm = normalizeTonAddress(safeText(body.address, 128));
    if (!norm) {
      return jsonResponse({ error: 'INVALID_TON_ADDRESS', message: 'Invalid TON wallet address.' }, 400);
    }
    const wallet = await repo.connectWallet(
      auth.user.id,
      norm.friendly,
      norm.raw,
      safeText(body.provider, 64) || null
    );
    return jsonResponse({ wallet });
  }

  if (apiPath === '/wallet/disconnect' && method === 'POST') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    await repo.disconnectWallet(auth.user.id);
    return jsonResponse({ ok: true });
  }

  if (apiPath === '/wallet/onchain-balances' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const activeWallet = await repo.getActiveWallet(auth.user.id);
    if (!activeWallet) return jsonResponse({ balances: null });

    const settings = await repo.getSettings();
    const tonCfg = resolveTonConfig(cfg, settings);
    const norm = normalizeTonAddress(activeWallet.wallet_address);
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
    const [settings, activeWallet] = await Promise.all([
      repo.getSettings(),
      repo.getActiveWallet(auth.user.id),
    ]);

    if (!activeWallet) return jsonResponse({ error: 'NO_WALLET', message: 'Connect a TON wallet first.' }, 400);
    if (activeWallet.is_suspended) return jsonResponse({ error: 'WALLET_SUSPENDED', message: 'This wallet has been suspended.' }, 403);
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

    if (await repo.hasTxHashBeenUsed(txHash)) {
      return jsonResponse({ error: 'DUPLICATE_TX_HASH', message: 'This transaction hash has already been used.' }, 409);
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

    let matchedAmountRaw = expectedRaw.toString();
    const match = (event.actions || []).find((act) => {
      if (act.type !== 'JettonTransfer' || act.status !== 'ok' || !act.JettonTransfer) return false;
      const jt = act.JettonTransfer;
      const m = normalizeRaw(jt.jetton?.address);
      const s = normalizeRaw(jt.sender?.address);
      const r = normalizeRaw(jt.recipient?.address);
      if (!m || !s || !r || !jt.amount) return false;
      try {
        if (m === masterNorm.raw && s === senderNorm.raw && r === adminNorm.raw && BigInt(jt.amount) >= expectedRaw) {
          matchedAmountRaw = jt.amount;
          return true;
        }
        return false;
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
    if (await repo.hasTxHashBeenUsed(finalHash)) {
      return jsonResponse({ error: 'DUPLICATE_TX_HASH', message: 'This blockchain event has already been claimed.' }, 409);
    }

    try {
      const saved = await repo.recordVerifiedWalletPayment({
        userId: auth.user.id,
        walletId: activeWallet.id,
        txHash: finalHash,
        senderAddress: senderNorm.raw,
        recipientAddress: adminNorm.raw,
        jettonMasterAddress: masterNorm.raw,
        amountRaw: matchedAmountRaw,
        amountDisplay: settings.gram_verification_fee,
        decimals: tonCfg.gramDecimals,
      });
      return jsonResponse(saved);
    } catch (err) {
      return jsonResponse({ error: 'DUPLICATE_TX_HASH', message: (err as Error).message }, 409);
    }
  }

  if (apiPath === '/wallet/verifications' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const verifications = await repo.getUserWalletVerifications(auth.user.id);
    return jsonResponse({ verifications });
  }

  // ============================================================================
  // WITHDRAWALS & TRANSACTIONS (Enforces 0.05 GRAM KYC)
  // ============================================================================
  if (apiPath === '/withdrawals' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const [withdrawals, settings] = await Promise.all([
      repo.getUserWithdrawals(auth.user.id),
      repo.getSettings(),
    ]);
    return jsonResponse({
      withdrawals,
      limits: { minWithdrawal: settings.min_withdrawal, maxWithdrawal: settings.max_withdrawal },
      isDemoTokenMode: false,
      isLiveTokenMode: true,
    });
  }

  if (apiPath === '/withdrawals/request' && method === 'POST') {
    try {
      const auth = await getAuthedUser();
      if (auth instanceof Response) return auth;
      const settings = await repo.getSettings();
      if (settings.maintenance_mode || settings.emergency_pause) {
        return jsonResponse({ error: 'SYSTEM_PAUSED', message: 'Withdrawals are temporarily paused.' }, 403);
      }

      const activeWallet = await repo.getActiveWallet(auth.user.id);
      if (!activeWallet) return jsonResponse({ error: 'WALLET_REQUIRED', message: 'Connect a TON wallet first.' }, 400);
      if (activeWallet.is_suspended) return jsonResponse({ error: 'WALLET_SUSPENDED', message: 'Your wallet is currently suspended.' }, 403);
      if (!activeWallet.is_verified) {
        return jsonResponse(
          {
            error: 'WALLET_UNVERIFIED',
            message: 'Complete the 0.05 GRAM wallet ownership verification before requesting a withdrawal.',
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
          {
            error: 'OUT_OF_RANGE',
            message: `Withdrawal must be between ${settings.min_withdrawal} and ${settings.max_withdrawal} LOVA.`,
          },
          400
        );
      }

      const result = await repo.requestWithdrawal(auth.user, activeWallet.wallet_address, amount);
      return jsonResponse(result);
    } catch (err) {
      return jsonResponse({ error: 'WITHDRAWAL_REQUEST_ERROR', message: (err as Error).message }, 400);
    }
  }

  if (apiPath === '/transactions' && method === 'GET') {
    const auth = await getAuthedUser();
    if (auth instanceof Response) return auth;
    const transactions = await repo.getUserTransactions(auth.user.id);
    return jsonResponse({ transactions });
  }

  // ============================================================================
  // ADMIN PANEL ROUTES
  // ============================================================================
  if (apiPath === '/admin/schema-sql' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    return jsonResponse({ sql: D1_SCHEMA_SQL });
  }

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
        if (schemaReady) {
          await repo.writeAuditLog({
            admin_id: adminId,
            admin_role: 'super_admin',
            action: 'ADMIN_LOGIN',
            target_type: 'auth',
            target_id: adminId,
            details: { method: 'bootstrap_secret' },
            ip_address: clientIp,
          });
        }
        return jsonResponse(
          { adminToken: token, role: 'super_admin', displayName: 'Super Admin' },
          200,
          { 'Set-Cookie': buildCookieHeader(ADMIN_COOKIE, token, 60 * 60 * 8, isHttps) }
        );
      }
      return jsonResponse({ error: 'INVALID_ADMIN_SECRET', message: 'Invalid administrator secret.' }, 401);
    }

    if (schemaReady) {
      const userToken = extractBearerOrCookie(request, SESSION_COOKIE, 'authorization');
      const userClaims = verifySessionToken(userToken, cfg.sessionSecret);
      if (userClaims && userClaims.kind === 'user') {
        const tgId = userClaims.tgId;
        const dbAdmin = await repo.getAdminByTelegramId(tgId);
        const inEnvList = cfg.adminTelegramIds.includes(tgId);
        if (dbAdmin || inEnvList) {
          const role: AdminRole = dbAdmin?.role || 'super_admin';
          const adminId = dbAdmin?.id || `tg-${tgId}`;
          const token = signSessionToken(
            { sub: userClaims.sub, tgId, kind: 'admin', adminId, adminRole: role },
            cfg.sessionSecret,
            60 * 60 * 8
          );
          await repo.writeAuditLog({
            admin_id: adminId,
            admin_role: role,
            action: 'ADMIN_LOGIN',
            target_type: 'auth',
            target_id: adminId,
            details: { method: 'telegram_id', telegram_id: tgId },
            ip_address: clientIp,
          });
          return jsonResponse(
            { adminToken: token, role, displayName: dbAdmin?.display_name || `Telegram Admin (${tgId})` },
            200,
            { 'Set-Cookie': buildCookieHeader(ADMIN_COOKIE, token, 60 * 60 * 8, isHttps) }
          );
        }

        const adminsCount = await repo.getAdminsCount();
        if (
          cfg.telegramAllowDevPreview &&
          !cfg.adminBootstrapSecret &&
          cfg.adminTelegramIds.length === 0 &&
          adminsCount === 0 &&
          body.bootstrapPreviewAdmin === true
        ) {
          const created = await repo.upsertAdmin({
            telegram_id: tgId,
            email: null,
            display_name: 'Preview Super Admin',
            role: 'super_admin',
          });
          const token = signSessionToken(
            { sub: userClaims.sub, tgId, kind: 'admin', adminId: created.id, adminRole: created.role },
            cfg.sessionSecret,
            60 * 60 * 8
          );
          await repo.writeAuditLog({
            admin_id: created.id,
            admin_role: created.role,
            action: 'ADMIN_PREVIEW_BOOTSTRAP',
            target_type: 'admins',
            target_id: created.id,
            details: { telegram_id: tgId },
            ip_address: clientIp,
          });
          return jsonResponse(
            { adminToken: token, role: created.role, displayName: created.display_name },
            200,
            { 'Set-Cookie': buildCookieHeader(ADMIN_COOKIE, token, 60 * 60 * 8, isHttps) }
          );
        }
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

  if (!schemaReady) {
    return jsonResponse(
      {
        error: 'D1_SCHEMA_MISSING',
        message:
          'Cloudflare D1 database is bound, but schema tables are not created yet. Apply schema.sql using Wrangler D1.',
      },
      503
    );
  }

  if (apiPath === '/admin/overview' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const [overview, settings] = await Promise.all([repo.getAdminOverview(), repo.getSettings()]);
    return jsonResponse({
      overview,
      settings,
      systemStatus: buildSystemStatus(cfg, 'd1', settings),
    });
  }

  if (apiPath === '/admin/users' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const search = url.searchParams.get('search') || '';
    const users = await repo.listAdminUsers(search);
    return jsonResponse({ users });
  }

  const userStatusMatch = apiPath.match(/^\/admin\/users\/([^/]+)\/status$/);
  if (userStatusMatch && method === 'POST') {
    try {
      const admin = getAuthedAdmin();
      if (admin instanceof Response) return admin;
      const body = await readJson<{ status?: UserStatus; reason?: string }>();
      if (!body.status || !['active', 'suspended', 'banned'].includes(body.status)) {
        return jsonResponse({ error: 'INVALID_STATUS', message: 'Invalid user status.' }, 400);
      }
      const reason = safeText(body.reason, 200);
      const updated = await repo.setUserStatus(userStatusMatch[1], body.status, reason);
      await repo.writeAuditLog({
        admin_id: admin.adminId || 'admin',
        admin_role: admin.adminRole || 'super_admin',
        action: `USER_${body.status.toUpperCase()}`,
        target_type: 'user',
        target_id: updated.id,
        details: { status: body.status, reason },
        ip_address: clientIp,
      });
      return jsonResponse({ user: updated });
    } catch (err) {
      return jsonResponse({ error: 'ADMIN_USER_STATUS_ERROR', message: (err as Error).message }, 400);
    }
  }

  if (apiPath === '/admin/settings' && method === 'PATCH') {
    try {
      const admin = getAuthedAdmin();
      if (admin instanceof Response) return admin;
      if (admin.adminRole === 'moderator') {
        return jsonResponse({ error: 'FORBIDDEN_ROLE', message: 'Moderators cannot change platform settings.' }, 403);
      }
      const body = await readJson<Record<string, unknown>>();
      const patch: Partial<AppSettings> = {};
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
      ] as const;
      for (const f of numFields) {
        if (body[f] !== undefined && Number.isFinite(Number(body[f])) && Number(body[f]) >= 0) {
          (patch as Record<string, unknown>)[f] = Number(body[f]);
        }
      }
      for (const f of ['mining_enabled', 'emergency_pause', 'maintenance_mode'] as const) {
        if (typeof body[f] === 'boolean') (patch as Record<string, unknown>)[f] = body[f];
      }
      if (typeof body.app_name === 'string' && body.app_name.trim()) {
        patch.app_name = safeText(body.app_name, 64);
      }
      for (const addrField of [
        'admin_ton_wallet_override',
        'admin_lova_wallet_address',
        'lova_jetton_master_address',
        'gram_jetton_master_address',
      ] as const) {
        if (typeof body[addrField] === 'string') {
          const trimmed = (body[addrField] as string).trim();
          if (!trimmed) {
            (patch as Record<string, unknown>)[addrField] = null;
          } else {
            const norm = normalizeTonAddress(trimmed);
            if (!norm) {
              return jsonResponse({ error: 'INVALID_TON_ADDRESS', message: `Invalid TON address for ${addrField}.` }, 400);
            }
            (patch as Record<string, unknown>)[addrField] = norm.friendly;
          }
        }
      }
      const settings = await repo.updateSettings(patch);
      await repo.writeAuditLog({
        admin_id: admin.adminId || 'admin',
        admin_role: admin.adminRole || 'super_admin',
        action: 'SETTINGS_UPDATED',
        target_type: 'app_settings',
        target_id: '1',
        details: patch as Record<string, unknown>,
        ip_address: clientIp,
      });
      return jsonResponse({ settings });
    } catch (err) {
      return jsonResponse({ error: 'ADMIN_SETTINGS_ERROR', message: (err as Error).message }, 400);
    }
  }

  if (apiPath === '/admin/withdrawals' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const withdrawals = await repo.listAdminWithdrawals();
    return jsonResponse({ withdrawals });
  }

  const wdActionMatch = apiPath.match(/^\/admin\/withdrawals\/([^/]+)\/action$/);
  if (wdActionMatch && method === 'POST') {
    try {
      const admin = getAuthedAdmin();
      if (admin instanceof Response) return admin;
      if (admin.adminRole === 'moderator') {
        return jsonResponse({ error: 'FORBIDDEN_ROLE', message: 'Moderators cannot process withdrawals.' }, 403);
      }
      const body = await readJson<{ action?: string; payoutTxHash?: string; adminNote?: string }>();
      const action = body.action;
      if (!action || !['approve', 'reject', 'mark_paid'].includes(action)) {
        return jsonResponse({ error: 'INVALID_ACTION', message: 'Action must be approve, reject, or mark_paid.' }, 400);
      }

      let payoutTxHash = safeText(body.payoutTxHash, 256);
      if (action === 'mark_paid') {
        if (!payoutTxHash || payoutTxHash.length < 16) {
          return jsonResponse(
            {
              error: 'PAYOUT_HASH_REQUIRED',
              message: 'A finalized TON payout transaction hash is required before marking a withdrawal as Paid.',
            },
            400
          );
        }
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (cfg.tonApiKey) headers.Authorization = `Bearer ${cfg.tonApiKey}`;
        const txRes = await fetch(
          `${cfg.tonApiEndpoint}/blockchain/transactions/${encodeURIComponent(payoutTxHash)}`,
          { headers }
        );
        if (!txRes.ok) {
          return jsonResponse(
            { error: 'PAYOUT_TX_NOT_VERIFIED', message: `Payout TX not confirmed on TON (${txRes.status}).` },
            422
          );
        }
        const tx = (await txRes.json()) as { hash?: string; success?: boolean; aborted?: boolean };
        if (tx.aborted || tx.success === false) {
          return jsonResponse({ error: 'PAYOUT_TX_NOT_VERIFIED', message: 'Payout TX failed on-chain.' }, 422);
        }
        payoutTxHash = tx.hash || payoutTxHash;
      }

      const updated = await repo.processWithdrawalAction({
        withdrawalId: wdActionMatch[1],
        action: action as 'approve' | 'reject' | 'mark_paid',
        adminId: admin.adminId || 'admin',
        adminNote: safeText(body.adminNote, 200),
        payoutTxHash,
      });

      await repo.writeAuditLog({
        admin_id: admin.adminId || 'admin',
        admin_role: admin.adminRole || 'super_admin',
        action: `WITHDRAWAL_${action.toUpperCase()}`,
        target_type: 'withdrawal',
        target_id: updated.id,
        details: { payoutTxHash: payoutTxHash || null, note: body.adminNote || null },
        ip_address: clientIp,
      });
      return jsonResponse({ withdrawal: updated });
    } catch (err) {
      return jsonResponse({ error: 'ADMIN_WITHDRAWAL_ACTION_ERROR', message: (err as Error).message }, 400);
    }
  }

  if (apiPath === '/admin/wallets' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const data = await repo.listAdminWalletsAndPayments();
    return jsonResponse(data);
  }

  const walletSuspendMatch = apiPath.match(/^\/admin\/wallets\/([^/]+)\/suspend$/);
  if (walletSuspendMatch && method === 'POST') {
    try {
      const admin = getAuthedAdmin();
      if (admin instanceof Response) return admin;
      const body = await readJson<{ suspended?: boolean }>();
      const suspended = Boolean(body.suspended);
      const wallet = await repo.toggleWalletSuspension(walletSuspendMatch[1], suspended);
      await repo.writeAuditLog({
        admin_id: admin.adminId || 'admin',
        admin_role: admin.adminRole || 'super_admin',
        action: suspended ? 'WALLET_SUSPENDED' : 'WALLET_UNSUSPENDED',
        target_type: 'user_wallet',
        target_id: wallet.id,
        details: { wallet_address: wallet.wallet_address },
        ip_address: clientIp,
      });
      return jsonResponse({ wallet });
    } catch (err) {
      return jsonResponse({ error: 'ADMIN_WALLET_SUSPEND_ERROR', message: (err as Error).message }, 400);
    }
  }

  // ADMIN LEVEL UPGRADE VERIFICATION & TIER MANAGEMENT
  if (apiPath === '/admin/level-upgrades' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const [requests, levels, settings] = await Promise.all([
      repo.listAdminLevelUpgrades(),
      repo.getMembershipLevels(true),
      repo.getSettings(),
    ]);
    const tonCfg = resolveTonConfig(cfg, settings);
    return jsonResponse({
      requests,
      levels,
      adminLovaWalletAddress: tonCfg.adminLovaWallet,
    });
  }

  const levelUpgradeActionMatch = apiPath.match(/^\/admin\/level-upgrades\/([^/]+)\/action$/);
  if (levelUpgradeActionMatch && method === 'POST') {
    try {
      const admin = getAuthedAdmin();
      if (admin instanceof Response) return admin;
      if (admin.adminRole === 'moderator') {
        return jsonResponse(
          { error: 'FORBIDDEN_ROLE', message: 'Moderators cannot approve or reject level-up payments.' },
          403
        );
      }
      const body = await readJson<{ action?: string; adminNote?: string }>();
      if (body.action !== 'approve' && body.action !== 'reject') {
        return jsonResponse({ error: 'INVALID_ACTION', message: 'Action must be either approve or reject.' }, 400);
      }
      const adminNote = safeText(body.adminNote, 240) || null;
      const result = await repo.processLevelUpgradeAction({
        requestId: levelUpgradeActionMatch[1],
        action: body.action,
        adminId: admin.adminId || 'admin',
        adminNote,
      });
      await repo.writeAuditLog({
        admin_id: admin.adminId || 'admin',
        admin_role: admin.adminRole || 'super_admin',
        action: body.action === 'approve' ? 'LEVEL_UPGRADE_APPROVED' : 'LEVEL_UPGRADE_REJECTED',
        target_type: 'level_upgrade_request',
        target_id: result.request.id,
        details: {
          user_id: result.user.id,
          from_level: result.request.from_level,
          target_level: result.request.target_level,
          required_lova_amount: result.request.required_lova_amount,
          tx_hash: result.request.tx_hash,
          adminNote,
        },
        ip_address: clientIp,
      });
      return jsonResponse(result);
    } catch (err) {
      return jsonResponse({ error: 'ADMIN_LEVEL_UPGRADE_ACTION_ERROR', message: (err as Error).message }, 400);
    }
  }

  if (apiPath === '/admin/levels' && method === 'POST') {
    try {
      const admin = getAuthedAdmin();
      if (admin instanceof Response) return admin;
      if (admin.adminRole === 'moderator') {
        return jsonResponse({ error: 'FORBIDDEN_ROLE', message: 'Moderators cannot edit membership tiers.' }, 403);
      }
      const body = await readJson<Partial<MembershipLevel>>();
      const levelNumber = Number(body.level_number);
      if (!Number.isInteger(levelNumber) || levelNumber < 1 || levelNumber > 20) {
        return jsonResponse({ error: 'INVALID_LEVEL', message: 'Valid level_number (1-20) is required.' }, 400);
      }
      const level = await repo.upsertMembershipLevel({
        level_number: levelNumber,
        name: typeof body.name === 'string' ? body.name : undefined,
        badge_label: typeof body.badge_label === 'string' ? body.badge_label : undefined,
        required_lova_amount: body.required_lova_amount !== undefined ? Number(body.required_lova_amount) : undefined,
        mining_multiplier: body.mining_multiplier !== undefined ? Number(body.mining_multiplier) : undefined,
        daily_bonus_multiplier:
          body.daily_bonus_multiplier !== undefined ? Number(body.daily_bonus_multiplier) : undefined,
        benefits: Array.isArray(body.benefits) ? body.benefits.map(String) : undefined,
        is_active: typeof body.is_active === 'boolean' ? body.is_active : undefined,
      });
      await repo.writeAuditLog({
        admin_id: admin.adminId || 'admin',
        admin_role: admin.adminRole || 'super_admin',
        action: 'MEMBERSHIP_LEVEL_UPDATED',
        target_type: 'membership_level',
        target_id: String(level.level_number),
        details: level as unknown as Record<string, unknown>,
        ip_address: clientIp,
      });
      return jsonResponse({ level });
    } catch (err) {
      return jsonResponse({ error: 'ADMIN_LEVEL_SAVE_ERROR', message: (err as Error).message }, 400);
    }
  }

  if (apiPath === '/admin/tasks' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const tasks = await repo.getTasksForUser('00000000-0000-0000-0000-000000000000', true);
    return jsonResponse({ tasks });
  }

  if (apiPath === '/admin/tasks' && method === 'POST') {
    try {
      const admin = getAuthedAdmin();
      if (admin instanceof Response) return admin;
      const body = await readJson<Record<string, unknown>>();
      const task = await repo.createOrUpdateTask(body);
      await repo.writeAuditLog({
        admin_id: admin.adminId || 'admin',
        admin_role: admin.adminRole || 'super_admin',
        action: body.id ? 'TASK_UPDATED' : 'TASK_CREATED',
        target_type: 'task',
        target_id: task.id,
        details: { title: task.title, reward: task.reward_amount },
        ip_address: clientIp,
      });
      return jsonResponse({ task });
    } catch (err) {
      return jsonResponse({ error: 'ADMIN_TASK_SAVE_ERROR', message: (err as Error).message }, 400);
    }
  }

  const taskDelMatch = apiPath.match(/^\/admin\/tasks\/([^/]+)$/);
  if (taskDelMatch && method === 'DELETE') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    await repo.deleteTask(taskDelMatch[1]);
    await repo.writeAuditLog({
      admin_id: admin.adminId || 'admin',
      admin_role: admin.adminRole || 'super_admin',
      action: 'TASK_DELETED',
      target_type: 'task',
      target_id: taskDelMatch[1],
      details: {},
      ip_address: clientIp,
    });
    return jsonResponse({ ok: true });
  }

  if (apiPath === '/admin/announcements' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const announcements = await repo.getAnnouncements(true);
    return jsonResponse({ announcements });
  }

  if (apiPath === '/admin/announcements' && method === 'POST') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const body = await readJson<{ title?: string; body?: string; category?: string }>();
    const title = safeText(body.title, 120);
    const msgBody = safeText(body.body, 600);
    const category = ['airdrop', 'update', 'maintenance', 'security'].includes(body.category || '')
      ? (body.category as 'airdrop' | 'update' | 'maintenance' | 'security')
      : 'airdrop';
    if (!title || !msgBody) {
      return jsonResponse({ error: 'INVALID_ANNOUNCEMENT', message: 'Title and body are required.' }, 400);
    }
    const announcement = await repo.createAnnouncement({ title, body: msgBody, category, is_active: true });
    await repo.writeAuditLog({
      admin_id: admin.adminId || 'admin',
      admin_role: admin.adminRole || 'super_admin',
      action: 'ANNOUNCEMENT_CREATED',
      target_type: 'announcement',
      target_id: announcement.id,
      details: { title, category },
      ip_address: clientIp,
    });
    return jsonResponse({ announcement });
  }

  const annDelMatch = apiPath.match(/^\/admin\/announcements\/([^/]+)$/);
  if (annDelMatch && method === 'DELETE') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    await repo.deleteAnnouncement(annDelMatch[1]);
    await repo.writeAuditLog({
      admin_id: admin.adminId || 'admin',
      admin_role: admin.adminRole || 'super_admin',
      action: 'ANNOUNCEMENT_DELETED',
      target_type: 'announcement',
      target_id: annDelMatch[1],
      details: {},
      ip_address: clientIp,
    });
    return jsonResponse({ ok: true });
  }

  if (apiPath === '/admin/referrals' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const data = await repo.listAdminReferrals();
    return jsonResponse(data);
  }

  if (apiPath === '/admin/audit-logs' && method === 'GET') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    const logs = await repo.listAuditLogs();
    return jsonResponse({ logs });
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
    if (admin.adminRole === 'moderator') {
      return jsonResponse({ error: 'FORBIDDEN_ROLE', message: 'Moderators cannot configure the Telegram Bot.' }, 403);
    }
    if (!cfg.telegramBotToken) {
      return jsonResponse({ error: 'TELEGRAM_BOT_TOKEN_MISSING', message: 'Set TELEGRAM_BOT_TOKEN.' }, 400);
    }
    const body = await readJson<{ miniAppUrl?: string; registerWebhook?: boolean }>();
    const cleanUrl = safeText(body.miniAppUrl, 300).replace(/\/+$/, '');
    if (!cleanUrl.startsWith('https://')) {
      return jsonResponse({ error: 'HTTPS_REQUIRED', message: 'HTTPS URL required.' }, 400);
    }

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
      callTelegramApi<{ username?: string }>(cfg, 'getMe'),
      callTelegramApi(cfg, 'getWebhookInfo'),
      callTelegramApi(cfg, 'getChatMenuButton'),
    ]);

    await repo.writeAuditLog({
      admin_id: admin.adminId || 'admin',
      admin_role: admin.adminRole || 'super_admin',
      action: 'TELEGRAM_BOT_CONFIGURED',
      target_type: 'telegram_bot',
      target_id: me.ok && me.result?.username ? me.result.username : 'bot',
      details: { miniAppUrl: cleanUrl, registerWebhook: body.registerWebhook !== false, ok: cmdRes.ok && menuRes.ok && whOk },
      ip_address: clientIp,
    });

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
    const admins = await repo.listAdmins();
    return jsonResponse({ admins, envAdminTelegramIds: cfg.adminTelegramIds });
  }

  if (apiPath === '/admin/admins' && method === 'POST') {
    const admin = getAuthedAdmin();
    if (admin instanceof Response) return admin;
    if (admin.adminRole !== 'super_admin') {
      return jsonResponse({ error: 'FORBIDDEN_ROLE', message: 'Only super_admin can edit admins.' }, 403);
    }
    const body = await readJson<{ telegram_id?: number; display_name?: string; role?: AdminRole }>();
    const tgId = Number(body.telegram_id);
    const role = body.role || 'moderator';
    if (!Number.isInteger(tgId) || tgId <= 0) {
      return jsonResponse({ error: 'INVALID_TELEGRAM_ID', message: 'Valid numeric Telegram ID required.' }, 400);
    }
    if (!['super_admin', 'finance_admin', 'moderator'].includes(role)) {
      return jsonResponse({ error: 'INVALID_ROLE', message: 'Role must be super_admin, finance_admin, or moderator.' }, 400);
    }
    const saved = await repo.upsertAdmin({
      telegram_id: tgId,
      email: null,
      display_name: safeText(body.display_name, 80) || `Admin ${tgId}`,
      role,
    });
    await repo.writeAuditLog({
      admin_id: admin.adminId || 'admin',
      admin_role: admin.adminRole || 'super_admin',
      action: 'ADMIN_UPSERTED',
      target_type: 'admins',
      target_id: saved.id,
      details: { telegram_id: tgId, role, display_name: saved.display_name },
      ip_address: clientIp,
    });
    return jsonResponse({ admin: saved });
  }

  const adminToggleMatch = apiPath.match(/^\/admin\/admins\/([^/]+)\/toggle$/);
  if (adminToggleMatch && method === 'POST') {
    try {
      const admin = getAuthedAdmin();
      if (admin instanceof Response) return admin;
      if (admin.adminRole !== 'super_admin') {
        return jsonResponse({ error: 'FORBIDDEN_ROLE', message: 'Only super_admin can toggle admins.' }, 403);
      }
      const body = await readJson<{ is_active?: boolean }>();
      const isActive = Boolean(body.is_active);
      const updated = await repo.toggleAdminActive(adminToggleMatch[1], isActive);
      await repo.writeAuditLog({
        admin_id: admin.adminId || 'admin',
        admin_role: admin.adminRole || 'super_admin',
        action: isActive ? 'ADMIN_ACTIVATED' : 'ADMIN_DEACTIVATED',
        target_type: 'admins',
        target_id: updated.id,
        details: { telegram_id: updated.telegram_id, role: updated.role },
        ip_address: clientIp,
      });
      return jsonResponse({ admin: updated });
    } catch (err) {
      return jsonResponse({ error: 'ADMIN_TOGGLE_ERROR', message: (err as Error).message }, 400);
    }
  }

  return jsonResponse({ error: 'API_NOT_FOUND', message: 'Unknown API endpoint.' }, 404);
}
