import { useEffect, useState } from 'react';
import { Crown, RefreshCw, ShieldAlert, ShieldCheck, UserCheck, Wallet } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { LovaUser, MembershipLevel, TransactionItem, UserWallet } from '../types/lova';

interface ProfileViewProps {
  user: LovaUser;
  activeWallet: UserWallet | null;
  currentMembership?: MembershipLevel;
  onOpenWallet: () => void;
  onOpenLevelUp?: () => void;
  onRefreshBootstrap?: () => Promise<void>;
}

export function ProfileView({
  user,
  activeWallet,
  currentMembership,
  onOpenWallet,
  onOpenLevelUp,
  onRefreshBootstrap,
}: ProfileViewProps) {
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await apiFetch<{ transactions: TransactionItem[] }>('/api/transactions');
        setTransactions(res.transactions);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    })();
  }, [user.id, user.total_earned]);

  const isKycVerified = Boolean(
    activeWallet && activeWallet.is_verified && !activeWallet.is_suspended
  );

  return (
    <div className="space-y-6">
      {/* Worker Identity Card (Zero Admin links in Worker Mode) */}
      <section className="glass-panel-elevated rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-white font-display font-bold text-xl shrink-0">
            {(user.first_name || user.username || 'L')[0].toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">
              {user.first_name || 'LOVA Miner'} {user.last_name || ''}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 mt-1">
              <span>{user.username ? `@${user.username}` : 'Telegram User'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">TG ID: {user.telegram_id}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-blue-300">Ref: {user.referral_code}</span>
              <span aria-hidden="true">·</span>
              <span>Joined {new Date(user.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {onOpenLevelUp && (
            <button
              type="button"
              onClick={onOpenLevelUp}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/35 text-amber-200 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Crown className="w-4 h-4 text-amber-300" />
              LVL {user.membership_level || 1} · {currentMembership?.name || 'Starter'} · Upgrade
            </button>
          )}
          <button
            type="button"
            onClick={onOpenWallet}
            className={`min-h-[44px] px-5 py-2.5 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors ${
              isKycVerified
                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                : 'bg-blue-600 hover:bg-blue-500 border-blue-500 text-white'
            }`}
          >
            {isKycVerified ? (
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            ) : (
              <ShieldAlert className="w-4 h-4" />
            )}
            {isKycVerified ? 'KYC Verified Wallet' : 'Complete 0.05 GRAM KYC'}
          </button>
        </div>
      </section>

      {/* Account & KYC Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 glass-panel rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-blue-400" />
              <h2 className="text-base font-semibold text-white">Worker Account &amp; KYC</h2>
            </div>
            {onRefreshBootstrap && (
              <button
                type="button"
                disabled={refreshing}
                onClick={async () => {
                  try {
                    setRefreshing(true);
                    await onRefreshBootstrap();
                  } finally {
                    setRefreshing(false);
                  }
                }}
                aria-label="Refresh account status"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 rounded-2xl bg-[#070B17] border border-slate-800">
              <p className="text-xs text-slate-400">Available LOVA</p>
              <p className="text-base font-bold font-mono tabular-nums text-white mt-0.5">
                {user.available_balance.toFixed(2)} LOVA
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-[#070B17] border border-slate-800">
              <p className="text-xs text-slate-400">Total Earned</p>
              <p className="text-base font-bold font-mono tabular-nums text-blue-300 mt-0.5">
                {user.total_earned.toFixed(2)} LOVA
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-[#070B17] border border-slate-800">
              <p className="text-xs text-slate-400">Pending Payout</p>
              <p className="text-base font-bold font-mono tabular-nums text-amber-300 mt-0.5">
                {user.pending_balance.toFixed(2)} LOVA
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-[#070B17] border border-slate-800">
              <p className="text-xs text-slate-400">Total Withdrawn</p>
              <p className="text-base font-bold font-mono tabular-nums text-emerald-300 mt-0.5">
                {user.total_withdrawn.toFixed(2)} LOVA
              </p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-[#070B17] border border-slate-800 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">TON Wallet KYC (0.05 GRAM)</span>
              <span
                className={`font-semibold ${
                  activeWallet?.is_suspended
                    ? 'text-rose-400'
                    : isKycVerified
                      ? 'text-emerald-400'
                      : 'text-amber-300'
                }`}
              >
                {activeWallet?.is_suspended
                  ? 'Suspended'
                  : isKycVerified
                    ? 'Verified'
                    : 'Verification Required'}
              </span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              {activeWallet
                ? `Connected: ${activeWallet.wallet_address.slice(0, 10)}...${activeWallet.wallet_address.slice(-8)}`
                : 'Connect your TON wallet and send 0.05 GRAM to unlock withdrawals.'}
            </p>
          </div>

          <div className="pt-3 border-t border-slate-800/70 flex items-center justify-between text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-blue-400" />
              Account Status: <strong className="text-slate-200 capitalize">{user.status}</strong>
            </span>
            <span className="font-mono tabular-nums">Streak: {user.streak_days}d</span>
          </div>
        </section>

        {/* Unified Transaction Ledger */}
        <section className="lg:col-span-7 glass-panel rounded-2xl p-5 sm:p-6">
          <h2 className="text-base font-semibold text-white mb-4">Account Activity Ledger</h2>
          {loading ? (
            <div className="space-y-2">
              <div className="h-10 rounded-lg bg-slate-800/50" />
              <div className="h-10 rounded-lg bg-slate-800/50" />
            </div>
          ) : transactions.length === 0 ? (
            <p className="text-sm text-slate-400 py-10 text-center">
              No account transactions recorded yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-800/70 max-h-[420px] overflow-y-auto pr-1">
              {transactions.map((tx) => (
                <div key={tx.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-100 truncate">{tx.description}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {tx.tx_type.replace('_', ' ')} ·{' '}
                      {tx.chain_tx_hash ? 'On-Chain TON' : 'TON Live Ledger'} ·{' '}
                      {new Date(tx.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span className="font-mono tabular-nums text-sm font-semibold text-blue-300 shrink-0">
                    {tx.tx_type === 'withdrawal_request' ? '-' : '+'}
                    {tx.amount.toFixed(tx.currency === 'GRAM' ? 2 : 4)} {tx.currency}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
