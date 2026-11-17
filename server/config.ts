import crypto from 'crypto';
import dotenv from 'dotenv';
import type { AppSettings, PublicSystemStatus } from '../src/types/lova.ts';

dotenv.config();

const runtimeFallbackSecret = crypto.randomBytes(32).toString('hex');

function normalizeBotToken(raw: string): string {
  return raw
    .trim()
    .replace(/^TELEGRAM_BOT_TOKEN\s*=\s*/i, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
    .replace(/^bot(?=\d+:)/i, '');
}

export const serverConfig = {
  port: Number(process.env.PORT || 3000),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Telegram
  telegramBotToken: normalizeBotToken(process.env.TELEGRAM_BOT_TOKEN || ''),
  telegramBotUsername: (process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@+/, '') || null,
  telegramWebhookSecret: (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim() || null,
  telegramAllowDevPreview:
    process.env.TELEGRAM_ALLOW_DEV_PREVIEW !== 'false' && process.env.NODE_ENV !== 'production',

  // Supabase
  supabaseUrl: (process.env.SUPABASE_URL || '').trim(),
  supabaseServiceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),

  // Session & Admin
  explicitSessionSecret: (process.env.SESSION_SECRET || '').trim() || null,
  sessionSecret: (process.env.SESSION_SECRET || '').trim() || runtimeFallbackSecret,
  adminBootstrapSecret: (process.env.ADMIN_BOOTSTRAP_SECRET || '').trim(),
  adminTelegramIds: (process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0),

  // TON & GRAM KYC Verification
  gramJettonMasterAddress: (process.env.GRAM_JETTON_MASTER_ADDRESS || '').trim() || null,
  gramJettonDecimals: process.env.GRAM_JETTON_DECIMALS
    ? Number(process.env.GRAM_JETTON_DECIMALS)
    : 9,
  adminTonWalletAddress: (process.env.ADMIN_TON_WALLET_ADDRESS || '').trim() || null,
  adminLovaWalletAddress: (process.env.ADMIN_LOVA_WALLET_ADDRESS || '').trim() || null,
  tonApiEndpoint: (process.env.TON_API_ENDPOINT || 'https://tonapi.io/v2').trim().replace(/\/+$/, ''),
  tonApiKey: (process.env.TON_API_KEY || '').trim() || null,

  // Live LOVA Jetton Contract on TON
  lovaJettonMasterAddress: (process.env.LOVA_JETTON_MASTER_ADDRESS || '').trim() || null,
  lovaJettonDecimals: process.env.LOVA_JETTON_DECIMALS
    ? Number(process.env.LOVA_JETTON_DECIMALS)
    : 9,
};

let supabaseSchemaReady = false;

export function setSupabaseSchemaReady(ready: boolean) {
  supabaseSchemaReady = ready;
}

export function hasSupabaseConfig(): boolean {
  return Boolean(serverConfig.supabaseUrl && serverConfig.supabaseServiceRoleKey);
}

export function resolveEffectiveTonConfig(settings?: Partial<AppSettings> | null) {
  const adminWallet =
    (settings?.admin_ton_wallet_override || serverConfig.adminTonWalletAddress || '').trim() || null;
  const adminLovaWallet =
    (
      settings?.admin_lova_wallet_address ||
      serverConfig.adminLovaWalletAddress ||
      settings?.admin_ton_wallet_override ||
      serverConfig.adminTonWalletAddress ||
      ''
    ).trim() || null;
  const gramMaster =
    (settings?.gram_jetton_master_address || serverConfig.gramJettonMasterAddress || '').trim() || null;
  const gramDecimals =
    settings?.gram_jetton_decimals !== undefined && settings?.gram_jetton_decimals !== null
      ? Number(settings.gram_jetton_decimals)
      : serverConfig.gramJettonDecimals;
  const lovaMaster =
    (settings?.lova_jetton_master_address || serverConfig.lovaJettonMasterAddress || '').trim() || null;
  const lovaDecimals =
    settings?.lova_jetton_decimals !== undefined && settings?.lova_jetton_decimals !== null
      ? Number(settings.lova_jetton_decimals)
      : serverConfig.lovaJettonDecimals;

  return {
    adminWallet,
    adminLovaWallet,
    gramMaster,
    gramDecimals,
    lovaMaster,
    lovaDecimals,
  };
}

export function isGramVerificationConfigured(
  overrideAdminWallet?: string | null,
  overrideGramMaster?: string | null,
  overrideGramDecimals?: number | null
): boolean {
  const adminWallet = (overrideAdminWallet || serverConfig.adminTonWalletAddress || '').trim();
  const gramMaster = (overrideGramMaster || serverConfig.gramJettonMasterAddress || '').trim();
  const decimals =
    overrideGramDecimals !== undefined && overrideGramDecimals !== null
      ? Number(overrideGramDecimals)
      : serverConfig.gramJettonDecimals;
  return Boolean(
    gramMaster &&
      decimals !== null &&
      Number.isInteger(decimals) &&
      decimals >= 0 &&
      decimals <= 18 &&
      adminWallet
  );
}

export function getPublicSystemStatus(
  gramFee = 0.05,
  overrideAdminWallet?: string | null,
  settings?: Partial<AppSettings> | null
): PublicSystemStatus {
  const resolved = resolveEffectiveTonConfig({
    ...settings,
    admin_ton_wallet_override: overrideAdminWallet ?? settings?.admin_ton_wallet_override,
  });

  const dbMode: PublicSystemStatus['databaseMode'] = !hasSupabaseConfig()
    ? 'local_preview'
    : supabaseSchemaReady
      ? 'supabase'
      : 'supabase_needs_schema';

  return {
    databaseMode: dbMode,
    telegramAuthMode:
      serverConfig.telegramBotToken && !serverConfig.telegramAllowDevPreview
        ? 'hmac_strict'
        : serverConfig.telegramBotToken
          ? 'hmac_strict'
          : 'preview_fallback',
    telegramBotConfigured: Boolean(serverConfig.telegramBotToken),
    telegramBotUsername: serverConfig.telegramBotUsername,
    isDemoTokenMode: false,
    isLiveTokenMode: true,
    lovaJettonMasterAddress: resolved.lovaMaster,
    lovaJettonDecimals: resolved.lovaDecimals,
    gramVerificationConfigured: isGramVerificationConfigured(
      resolved.adminWallet,
      resolved.gramMaster,
      resolved.gramDecimals
    ),
    gramVerificationFee: gramFee,
    gramJettonMasterAddress: resolved.gramMaster,
    gramJettonDecimals: resolved.gramDecimals,
    adminTonWalletAddress: resolved.adminWallet,
    adminLovaWalletAddress: resolved.adminLovaWallet,
    tonApiConfigured: Boolean(serverConfig.tonApiEndpoint),
    adminBootstrapConfigured: Boolean(
      serverConfig.adminBootstrapSecret || serverConfig.adminTelegramIds.length > 0
    ),
  };
}
