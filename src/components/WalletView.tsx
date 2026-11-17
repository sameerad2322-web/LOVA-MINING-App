import { useEffect, useState } from 'react';
import { TonConnectButton, useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Info,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Unlink,
  Wallet,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { buildJettonTransferPayloadBase64, getBocHashHex } from '../lib/tonPayload';
import type {
  AppSettings,
  LovaUser,
  OnChainWalletBalances,
  PublicSystemStatus,
  UserWallet,
  WalletVerification,
  WithdrawalItem,
} from '../types/lova';

interface WalletViewProps {
  user: LovaUser;
  activeWallet: UserWallet | null;
  settings: AppSettings;
  systemStatus: PublicSystemStatus;
  onRefreshBootstrap: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function WalletView({
  user,
  activeWallet,
  settings,
  systemStatus,
  onRefreshBootstrap,
  onToast,
}: WalletViewProps) {
  const tonWallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();

  const [verifications, setVerifications] = useState<WalletVerification[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalItem[]>([]);
  const [onChainBalances, setOnChainBalances] = useState<OnChainWalletBalances | null>(null);
  const [onChainLoading, setOnChainLoading] = useState(false);
  const [limits, setLimits] = useState({
    minWithdrawal: settings.min_withdrawal,
    maxWithdrawal: settings.max_withdrawal,
  });

  const [manualTxHash, setManualTxHash] = useState('');
  const [jettonWalletInput, setJettonWalletInput] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'verify' | 'withdraw' | null>(null);

  const isKycVerified = Boolean(
    activeWallet && activeWallet.is_verified && !activeWallet.is_suspended
  );

  const loadOnChainBalances = async () => {
    if (!activeWallet) {
      setOnChainBalances(null);
      return;
    }
    try {
      setOnChainLoading(true);
      const res = await apiFetch<{ balances: OnChainWalletBalances | null }>(
        '/api/wallet/onchain-balances'
      );
      setOnChainBalances(res.balances);
      if (res.balances?.gramJettonWallet) {
        setJettonWalletInput((curr) => curr || res.balances!.gramJettonWallet!);
      }
    } catch {
      // silent if TonAPI is rate-limited or offline
    } finally {
      setOnChainLoading(false);
    }
  };

  const loadWalletData = async () => {
    try {
      const [verRes, wdRes] = await Promise.all([
        apiFetch<{ verifications: WalletVerification[] }>('/api/wallet/verifications'),
        apiFetch<{
          withdrawals: WithdrawalItem[];
          limits: { minWithdrawal: number; maxWithdrawal: number };
        }>('/api/withdrawals'),
      ]);
      setVerifications(verRes.verifications);
      setWithdrawals(wdRes.withdrawals);
      setLimits(wdRes.limits);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    void loadWalletData();
    void loadOnChainBalances();
  }, [user.id, activeWallet?.id, activeWallet?.wallet_address]);

  // Sync TON Connect wallet address to backend securely whenever user connects in TON Connect modal
  useEffect(() => {
    const addr = tonWallet?.account?.address;
    if (!addr) return;
    if (activeWallet && activeWallet.raw_address.toLowerCase() === addr.toLowerCase()) return;

    (async () => {
      try {
        setBusy('connect');
        await apiFetch('/api/wallet/connect', {
          method: 'POST',
          body: JSON.stringify({
            address: addr,
            provider: tonWallet.device?.appName || 'TON Connect',
          }),
        });
        await onRefreshBootstrap();
        onToast(
          'info',
          'TON wallet connected. Complete 0.05 GRAM KYC verification to unlock withdrawals.'
        );
      } catch (err) {
        onToast('error', (err as Error).message);
      } finally {
        setBusy(null);
      }
    })();
  }, [tonWallet?.account?.address]);

  const handleDisconnect = async () => {
    try {
      setBusy('disconnect');
      if (tonWallet) {
        await tonConnectUI.disconnect();
      }
      await apiFetch('/api/wallet/disconnect', { method: 'POST' });
      setJettonWalletInput('');
      setOnChainBalances(null);
      await onRefreshBootstrap();
      onToast('info', 'TON wallet disconnected.');
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handlePayAndVerifyGram = async () => {
    if (!activeWallet || !systemStatus.gramVerificationConfigured) return;
    if (!tonWallet) {
      onToast('error', 'Connect your TON wallet via TON Connect first.');
      return;
    }
    if (!jettonWalletInput.trim()) {
      onToast(
        'error',
        'Enter your GRAM Jetton Wallet address or verify an existing finalized TX hash below.'
      );
      return;
    }

    try {
      setBusy('verify');
      const payload = buildJettonTransferPayloadBase64({
        amount: systemStatus.gramVerificationFee,
        decimals: systemStatus.gramJettonDecimals!,
        destinationAddress: systemStatus.adminTonWalletAddress!,
        responseAddress: activeWallet.wallet_address,
        comment: `LOVA-${user.telegram_id}`,
      });

      const txResult = await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
          {
            address: jettonWalletInput.trim(),
            amount: '65000000', // 0.065 TON gas attached (excess returned to sender)
            payload,
          },
        ],
      });

      const bocHash = getBocHashHex(txResult.boc);
      setManualTxHash(bocHash);
      onToast(
        'info',
        'Transaction signed! Submitting hash to server for on-chain KYC finality verification...'
      );

      await apiFetch('/api/wallet/verify-gram', {
        method: 'POST',
        body: JSON.stringify({ txHash: bocHash }),
      });
      await onRefreshBootstrap();
      await loadWalletData();
      await loadOnChainBalances();
      onToast('success', 'Wallet KYC verified on-chain via 0.05 GRAM Jetton transfer!');
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleVerifyManualHash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTxHash.trim()) return;
    try {
      setBusy('verify');
      await apiFetch('/api/wallet/verify-gram', {
        method: 'POST',
        body: JSON.stringify({ txHash: manualTxHash.trim() }),
      });
      setManualTxHash('');
      await onRefreshBootstrap();
      await loadWalletData();
      await loadOnChainBalances();
      onToast('success', '0.05 GRAM KYC transaction verified on-chain! Withdrawals unlocked.');
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleRequestWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isKycVerified) {
      onToast(
        'error',
        'Wallet KYC required: Verify your connected TON wallet with 0.05 GRAM before requesting a withdrawal.'
      );
      return;
    }
    const num = Number(withdrawAmount);
    if (!Number.isFinite(num) || num <= 0) {
      onToast('error', 'Enter a valid withdrawal amount.');
      return;
    }
    try {
      setBusy('withdraw');
      await apiFetch('/api/withdrawals/request', {
        method: 'POST',
        body: JSON.stringify({ amount: num }),
      });
      setWithdrawAmount('');
      await onRefreshBootstrap();
      await loadWalletData();
      onToast('success', 'Withdrawal request submitted for admin payout.');
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Wallet Connection, Live On-Chain Balances & 0.05 GRAM KYC */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section
          id="gram-kyc-section"
          className="lg:col-span-6 glass-panel-elevated rounded-3xl p-6 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-white">TON Wallet &amp; KYC</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Tonkeeper, TON Space &amp; TON Connect wallets · Never enter seed phrases
              </p>
            </div>
            <TonConnectButton />
          </div>

          {activeWallet ? (
            <div className="p-4 rounded-2xl bg-[#070B17] border border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-400">
                  {activeWallet.wallet_provider || 'Connected TON Wallet'}
                </span>
                {activeWallet.is_suspended ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-400">
                    <ShieldAlert className="w-4 h-4" />
                    Suspended
                  </span>
                ) : activeWallet.is_verified ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                    <ShieldCheck className="w-4 h-4" />
                    KYC Verified (0.05 GRAM)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                    <AlertTriangle className="w-4 h-4" />
                    KYC Verification Required
                  </span>
                )}
              </div>

              <p className="font-mono text-xs sm:text-sm text-slate-100 break-all">
                {activeWallet.wallet_address}
              </p>

              {/* Live On-Chain TON Wallet Balances */}
              <div className="pt-3 border-t border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Live On-Chain TON Balances</span>
                  <button
                    type="button"
                    disabled={onChainLoading}
                    onClick={() => void loadOnChainBalances()}
                    className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${onChainLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-900/75 border border-slate-800/90">
                    <p className="text-[11px] text-slate-400">TON</p>
                    <p className="font-mono tabular-nums font-semibold text-white mt-0.5 truncate">
                      {onChainBalances ? onChainBalances.tonBalance : '—'}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-900/75 border border-slate-800/90">
                    <p className="text-[11px] text-slate-400">LOVA Jetton</p>
                    <p className="font-mono tabular-nums font-semibold text-blue-300 mt-0.5 truncate">
                      {onChainBalances?.lovaBalance ?? '—'}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-900/75 border border-slate-800/90">
                    <p className="text-[11px] text-slate-400">GRAM</p>
                    <p className="font-mono tabular-nums font-semibold text-emerald-300 mt-0.5 truncate">
                      {onChainBalances?.gramBalance ?? '—'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs text-slate-400">
                <span>
                  {activeWallet.verified_at
                    ? `KYC Verified ${new Date(activeWallet.verified_at).toLocaleDateString()}`
                    : 'Switching wallets requires fresh 0.05 GRAM KYC verification'}
                </span>
                <button
                  type="button"
                  disabled={busy === 'disconnect'}
                  onClick={handleDisconnect}
                  className="inline-flex items-center gap-1.5 text-rose-300 hover:text-rose-200 font-medium"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="p-6 rounded-2xl bg-[#070B17] border border-slate-800 text-center space-y-2">
              <Wallet className="w-8 h-8 text-blue-400 mx-auto" />
              <p className="text-sm font-medium text-slate-200">No TON Wallet Connected</p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Connect Tonkeeper or TON Space above, then complete 0.05 GRAM KYC verification to
                unlock LOVA withdrawals.
              </p>
            </div>
          )}

          {/* 0.05 GRAM KYC Verification Module */}
          <div className="pt-4 border-t border-slate-800/80 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-white">
                Wallet KYC Verification ({systemStatus.gramVerificationFee} GRAM)
              </h2>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                Mandatory KYC fee:{' '}
                <strong className="font-mono text-blue-300">
                  {systemStatus.gramVerificationFee} GRAM
                </strong>{' '}
                (a real <strong>GRAM Jetton transfer on TON</strong>). Withdrawals remain locked
                until this transaction confirms on-chain. Your wallet also attaches ~0.065 TON for
                network gas (unused gas is refunded).
              </p>
            </div>

            {!systemStatus.gramVerificationConfigured ? (
              <div className="p-4 rounded-2xl bg-amber-950/25 border border-amber-500/30 space-y-2 text-xs">
                <div className="flex items-center gap-2 font-semibold text-amber-200">
                  <Info className="w-4 h-4 text-amber-400 shrink-0" />
                  0.05 GRAM KYC Contract Pending Configuration
                </div>
                <p className="text-amber-200/80 leading-relaxed">
                  On-chain GRAM verification is disabled until the platform administrator configures
                  the verified GRAM Jetton contract and receiving TON wallet address in Admin Panel
                  Settings.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-1.5">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">KYC Receiving Address</span>
                    <span className="font-mono text-slate-200 truncate max-w-[220px]">
                      {systemStatus.adminTonWalletAddress}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">GRAM Master Contract</span>
                    <span className="font-mono text-slate-200 truncate max-w-[220px]">
                      {systemStatus.gramJettonMasterAddress}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">Required KYC Amount</span>
                    <span className="font-mono font-semibold text-blue-300">
                      {systemStatus.gramVerificationFee} GRAM ({systemStatus.gramJettonDecimals}{' '}
                      decimals)
                    </span>
                  </div>
                </div>

                {activeWallet && !activeWallet.is_verified && !activeWallet.is_suspended && (
                  <>
                    <div className="space-y-2">
                      <label className="block text-xs text-slate-300">
                        Your GRAM Jetton Wallet Address{' '}
                        {onChainBalances?.gramJettonWallet
                          ? '(auto-detected from TON blockchain)'
                          : '(required to build TEP-74 transfer)'}
                      </label>
                      <input
                        type="text"
                        value={jettonWalletInput}
                        onChange={(e) => setJettonWalletInput(e.target.value)}
                        placeholder="EQ... (your GRAM Jetton wallet address)"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#070B17] border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                      />
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={handlePayAndVerifyGram}
                        className="w-full min-h-[44px] rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white text-sm font-semibold transition-all disabled:opacity-50"
                      >
                        {busy === 'verify'
                          ? 'Awaiting Wallet & Blockchain Check...'
                          : `Pay ${systemStatus.gramVerificationFee} GRAM & Verify KYC`}
                      </button>
                    </div>

                    <form
                      onSubmit={handleVerifyManualHash}
                      className="pt-3 border-t border-slate-800/70 space-y-2"
                    >
                      <label className="block text-xs text-slate-400">
                        Already sent {systemStatus.gramVerificationFee} GRAM from your connected
                        wallet? Paste finalized TX hash:
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={manualTxHash}
                          onChange={(e) => setManualTxHash(e.target.value)}
                          placeholder="TON transaction or event hash"
                          className="flex-1 px-3 py-2 rounded-xl bg-[#070B17] border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                        />
                        <button
                          type="submit"
                          disabled={busy !== null || !manualTxHash.trim()}
                          className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Verify Hash
                        </button>
                      </div>
                    </form>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Live LOVA Balance & KYC-Gated Withdrawal Request Form */}
        <section className="lg:col-span-6 glass-panel rounded-3xl p-6 space-y-5">
          <div>
            <p className="text-xs font-medium text-blue-300">
              Live LOVA Balance · TON Network
              {systemStatus.lovaJettonMasterAddress
                ? ` · ${systemStatus.lovaJettonMasterAddress.slice(0, 6)}...${systemStatus.lovaJettonMasterAddress.slice(-4)}`
                : ''}
            </p>
            <h2 className="text-xl font-bold text-white mt-0.5">Balances &amp; Withdrawals</h2>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 rounded-2xl bg-[#070B17] border border-slate-800">
              <p className="text-xs text-slate-400">Available LOVA</p>
              <p className="text-lg font-bold font-mono tabular-nums text-white mt-0.5">
                {user.available_balance.toFixed(2)} LOVA
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-[#070B17] border border-slate-800">
              <p className="text-xs text-slate-400">Pending Review</p>
              <p className="text-lg font-bold font-mono tabular-nums text-amber-300 mt-0.5">
                {user.pending_balance.toFixed(2)} LOVA
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-[#070B17] border border-slate-800">
              <p className="text-xs text-slate-400">Total Earned</p>
              <p className="text-lg font-bold font-mono tabular-nums text-blue-300 mt-0.5">
                {user.total_earned.toFixed(2)} LOVA
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-[#070B17] border border-slate-800">
              <p className="text-xs text-slate-400">Total Withdrawn</p>
              <p className="text-lg font-bold font-mono tabular-nums text-emerald-300 mt-0.5">
                {user.total_withdrawn.toFixed(2)} LOVA
              </p>
            </div>
          </div>

          {!isKycVerified ? (
            <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/35 space-y-2.5 text-xs">
              <div className="flex items-center gap-2 font-semibold text-amber-200">
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                Withdrawals Locked — 0.05 GRAM KYC Required
              </div>
              <p className="text-amber-100/85 leading-relaxed">
                {activeWallet?.is_suspended
                  ? 'Your connected wallet is currently suspended. Contact support before requesting withdrawals.'
                  : !activeWallet
                    ? 'Connect your TON wallet and complete the 0.05 GRAM on-chain KYC verification to unlock withdrawal requests.'
                    : 'Your TON wallet is connected, but 0.05 GRAM KYC verification is not complete yet. Verify 0.05 GRAM to unlock withdrawals.'}
              </p>
              <a
                href="#gram-kyc-section"
                className="inline-flex items-center gap-1.5 text-blue-300 hover:text-blue-200 font-semibold"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Go to 0.05 GRAM KYC Verification
              </a>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-emerald-950/25 border border-emerald-500/30 text-xs text-emerald-200 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                KYC verified. Payouts will be sent on TON to{' '}
                <strong className="font-mono">
                  {activeWallet!.wallet_address.slice(0, 8)}...
                  {activeWallet!.wallet_address.slice(-6)}
                </strong>
                .
              </span>
            </div>
          )}

          <form onSubmit={handleRequestWithdrawal} className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Withdrawal Amount (LOVA)</span>
              <span className="font-mono tabular-nums">
                Min {limits.minWithdrawal} · Max {limits.maxWithdrawal}
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                step="0.01"
                min={limits.minWithdrawal}
                max={limits.maxWithdrawal}
                disabled={!isKycVerified || busy !== null}
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder={
                  isKycVerified
                    ? `Enter ${limits.minWithdrawal}+ LOVA`
                    : 'Complete 0.05 GRAM KYC first'
                }
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#070B17] border border-slate-700 text-sm font-mono tabular-nums text-white focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <button
                type="button"
                disabled={!isKycVerified || busy !== null}
                onClick={() =>
                  setWithdrawAmount(
                    String(Math.min(user.available_balance, limits.maxWithdrawal))
                  )
                }
                className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Max
              </button>
            </div>

            <button
              type="submit"
              disabled={busy !== null || !isKycVerified}
              className="w-full min-h-[46px] rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isKycVerified ? (
                <ArrowUpRight className="w-4 h-4" />
              ) : (
                <Lock className="w-4 h-4" />
              )}
              {busy === 'withdraw'
                ? 'Submitting Request...'
                : isKycVerified
                  ? 'Submit Withdrawal Request'
                  : 'KYC Required (Verify 0.05 GRAM to Withdraw)'}
            </button>
          </form>
        </section>
      </div>

      {/* Payment & Withdrawal History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="glass-panel rounded-2xl p-5 sm:p-6">
          <h3 className="text-base font-semibold text-white mb-3">
            GRAM KYC Verification History
          </h3>
          {verifications.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">
              No verified 0.05 GRAM KYC payments recorded yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-800/70">
              {verifications.map((v) => (
                <div key={v.id} className="py-3 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-emerald-400 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {v.amount_display} GRAM KYC Verified
                    </span>
                    <span className="font-mono tabular-nums text-slate-400">
                      {new Date(v.verified_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-slate-400 truncate">
                    TX: {v.tx_hash}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="glass-panel rounded-2xl p-5 sm:p-6">
          <h3 className="text-base font-semibold text-white mb-3">Withdrawal History</h3>
          {withdrawals.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">
              No withdrawal requests submitted yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-800/70">
              {withdrawals.map((w) => (
                <div key={w.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-mono font-semibold tabular-nums text-white">
                      {w.amount.toFixed(2)} LOVA
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      To {w.destination_address} · {new Date(w.created_at).toLocaleDateString()}
                    </p>
                    {w.payout_tx_hash && (
                      <p className="text-[11px] font-mono text-blue-300 truncate mt-0.5">
                        Payout TX: {w.payout_tx_hash}
                      </p>
                    )}
                  </div>
                  <span
                    className={`text-xs font-semibold inline-flex items-center gap-1 shrink-0 ${
                      w.status === 'Paid'
                        ? 'text-emerald-400'
                        : w.status === 'Approved'
                          ? 'text-blue-300'
                          : w.status === 'Rejected'
                            ? 'text-rose-400'
                            : 'text-amber-300'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    {w.status}
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
