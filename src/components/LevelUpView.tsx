import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Crown,
  ExternalLink,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  XCircle,
  Zap,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  LevelUpgradeRequest,
  LevelUpgradeStatus,
  LovaUser,
  MembershipLevel,
  PublicSystemStatus,
  UserWallet,
} from '../types/lova';

interface LevelUpViewProps {
  user: LovaUser;
  activeWallet: UserWallet | null;
  systemStatus: PublicSystemStatus;
  initialLevels?: MembershipLevel[];
  onRefreshBootstrap: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

interface LevelsResponse {
  currentLevel: number;
  currentMembership: MembershipLevel;
  levels: MembershipLevel[];
  requests: LevelUpgradeRequest[];
  adminLovaWalletAddress: string | null;
  lovaJettonMasterAddress: string | null;
}

function StatusBadge({ status }: { status: LevelUpgradeStatus }) {
  if (status === 'Approved') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Approved
      </span>
    );
  }
  if (status === 'Rejected') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold">
        <XCircle className="w-3.5 h-3.5" />
        Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold">
      <Clock className="w-3.5 h-3.5" />
      Pending
    </span>
  );
}

export function LevelUpView({
  user,
  activeWallet,
  systemStatus,
  initialLevels = [],
  onRefreshBootstrap,
  onToast,
}: LevelUpViewProps) {
  const [levels, setLevels] = useState<MembershipLevel[]>(initialLevels);
  const [requests, setRequests] = useState<LevelUpgradeRequest[]>([]);
  const [adminWallet, setAdminWallet] = useState<string | null>(
    systemStatus.adminLovaWalletAddress || systemStatus.adminTonWalletAddress || null
  );
  const [lovaContract, setLovaContract] = useState<string | null>(
    systemStatus.lovaJettonMasterAddress || null
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedLevel, setSelectedLevel] = useState<number>(0);
  const [txHash, setTxHash] = useState('');
  const [senderWallet, setSenderWallet] = useState(activeWallet?.wallet_address || '');
  const [submitting, setSubmitting] = useState(false);
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [copiedContract, setCopiedContract] = useState(false);

  const currentLevelNumber = user.membership_level || 1;

  const loadLevelsData = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        else setRefreshing(true);

        const data = await apiFetch<LevelsResponse>('/api/levels');
        setLevels(data.levels);
        setRequests(data.requests);
        setAdminWallet(data.adminLovaWalletAddress);
        setLovaContract(data.lovaJettonMasterAddress);

        const upgradeable = data.levels.filter((l) => l.level_number > (user.membership_level || 1));
        setSelectedLevel((prev) => {
          if (upgradeable.some((u) => u.level_number === prev)) return prev;
          return upgradeable[0]?.level_number || 0;
        });
      } catch (err) {
        onToast('error', (err as Error).message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onToast, user.membership_level]
  );

  useEffect(() => {
    void loadLevelsData(false);
  }, [loadLevelsData]);

  useEffect(() => {
    if (activeWallet?.wallet_address && !senderWallet) {
      setSenderWallet(activeWallet.wallet_address);
    }
  }, [activeWallet?.wallet_address, senderWallet]);

  const currentMembership = useMemo(() => {
    return (
      levels.find((l) => l.level_number === currentLevelNumber) ||
      levels[0] || {
        level_number: 1,
        name: 'Starter Miner',
        badge_label: 'LVL 1',
        required_lova_amount: 0,
        mining_multiplier: 1,
        daily_bonus_multiplier: 1,
        benefits: ['Standard 1.0x mining speed'],
        is_active: true,
      }
    );
  }, [levels, currentLevelNumber]);

  const upgradeOptions = useMemo(
    () => levels.filter((l) => l.level_number > currentLevelNumber && l.required_lova_amount > 0),
    [levels, currentLevelNumber]
  );

  const selectedTier = useMemo(
    () => upgradeOptions.find((l) => l.level_number === selectedLevel) || upgradeOptions[0] || null,
    [upgradeOptions, selectedLevel]
  );

  const pendingRequest = useMemo(
    () => requests.find((r) => r.status === 'Pending') || null,
    [requests]
  );

  const handleCopy = async (text: string, which: 'wallet' | 'contract') => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'wallet') {
        setCopiedWallet(true);
        setTimeout(() => setCopiedWallet(false), 2500);
        onToast('success', 'Official Admin LOVA wallet address copied!');
      } else {
        setCopiedContract(true);
        setTimeout(() => setCopiedContract(false), 2500);
        onToast('success', 'LOVA Jetton contract address copied!');
      }
    } catch {
      onToast('error', 'Unable to copy to clipboard.');
    }
  };

  const handleSubmitUpgrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTier) {
      onToast('error', 'No higher membership level selected.');
      return;
    }
    if (!adminWallet) {
      onToast('error', 'Official Admin LOVA wallet address is not configured yet.');
      return;
    }
    if (txHash.trim().length < 16) {
      onToast('error', 'Please enter a valid payment transaction hash (TXID).');
      return;
    }

    try {
      setSubmitting(true);
      await apiFetch<{ request: LevelUpgradeRequest }>('/api/levels/upgrade-request', {
        method: 'POST',
        body: JSON.stringify({
          targetLevel: selectedTier.level_number,
          txHash: txHash.trim(),
          senderWalletAddress: senderWallet.trim() || undefined,
        }),
      });
      setTxHash('');
      await loadLevelsData(true);
      await onRefreshBootstrap();
      onToast(
        'success',
        `Payment TXID submitted for ${selectedTier.name} (Level ${selectedTier.level_number}). Status: Pending Admin verification.`
      );
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* HERO: CURRENT LEVEL & EXTERNAL PAYMENT RULE */}
      <section className="glass-panel-elevated rounded-3xl p-6 sm:p-8 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/25 via-blue-600/25 to-violet-600/25 border border-amber-400/35 flex items-center justify-center shrink-0">
              <Crown className="w-7 h-7 text-amber-300" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/35 text-blue-200 text-xs font-mono font-semibold">
                  {currentMembership.badge_label}
                </span>
                <span className="text-xs text-slate-400">Your Current Membership Level</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-display font-bold text-white mt-1">
                Level {currentMembership.level_number}: {currentMembership.name}
              </h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300 mt-1.5">
                <span className="inline-flex items-center gap-1 font-mono tabular-nums text-blue-300">
                  <Zap className="w-3.5 h-3.5 text-blue-400" />
                  {currentMembership.mining_multiplier.toFixed(2)}x Mining Speed
                </span>
                <span className="inline-flex items-center gap-1 font-mono tabular-nums text-violet-300">
                  <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                  {currentMembership.daily_bonus_multiplier.toFixed(2)}x Daily Bonus
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadLevelsData(true)}
            disabled={refreshing}
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5 shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Status
          </button>
        </div>

        {/* Mandatory Policy Banner: Cannot use in-app balance */}
        <div className="rounded-2xl bg-amber-950/30 border border-amber-500/30 p-4 flex items-start gap-3 text-xs leading-relaxed">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1 text-amber-100/90">
            <p className="font-semibold text-amber-200">
              External LOVA Token Purchase Required — In-App Balances Cannot Be Used
            </p>
            <p>
              To upgrade your membership level, you must purchase LOVA tokens externally and manually
              send the required LOVA amount from your personal TON wallet to the Admin&apos;s official
              LOVA wallet below. Your in-app mining balance (
              <span className="font-mono font-semibold text-white">
                {user.available_balance.toFixed(2)} LOVA
              </span>
              ), reward balance, or pending balance is <strong>never</strong> deducted or accepted for
              upgrades.
            </p>
          </div>
        </div>
      </section>

      {/* OFFICIAL ADMIN LOVA WALLET ADDRESS + TXID SUBMISSION */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Admin LOVA Receiving Wallet & Instructions */}
        <section className="lg:col-span-5 glass-panel rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-white">Admin Official LOVA Wallet</h2>
              <p className="text-xs text-slate-400">
                Send your upgrade payment manually on TON to this address
              </p>
            </div>
          </div>

          {adminWallet ? (
            <div className="p-4 rounded-2xl bg-[#070B17] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-400">Official LOVA Receiving Address</span>
                <span className="text-emerald-300 font-semibold">TON Mainnet</span>
              </div>
              <p className="font-mono text-xs sm:text-sm text-white break-all bg-slate-900/90 border border-slate-800 rounded-xl p-3 select-all">
                {adminWallet}
              </p>
              <button
                type="button"
                onClick={() => void handleCopy(adminWallet, 'wallet')}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
              >
                {copiedWallet ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copiedWallet ? 'Wallet Address Copied' : 'Copy Admin LOVA Wallet Address'}
              </button>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-rose-950/25 border border-rose-500/30 text-xs text-rose-200 leading-relaxed">
              The Admin official LOVA receiving wallet address has not been configured yet. Please
              check back shortly or contact platform support.
            </div>
          )}

          {lovaContract && (
            <div className="p-3.5 rounded-xl bg-[#070B17] border border-slate-800 space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">LOVA Jetton Master Contract</span>
                <button
                  type="button"
                  onClick={() => void handleCopy(lovaContract, 'contract')}
                  className="text-blue-300 hover:text-blue-200 inline-flex items-center gap-1 font-medium"
                >
                  {copiedContract ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedContract ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="font-mono text-[11px] text-slate-300 break-all">{lovaContract}</p>
            </div>
          )}

          <div className="space-y-2 pt-1 text-xs text-slate-300">
            <p className="font-semibold text-white">How Level Upgrade Works:</p>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-400 leading-relaxed">
              <li>Select your desired membership level from the tiers below.</li>
              <li>Copy the Admin&apos;s official LOVA wallet address above.</li>
              <li>
                Purchase &amp; transfer the exact required{' '}
                <strong className="text-slate-200">LOVA tokens</strong> from your external TON wallet.
              </li>
              <li>
                Submit your payment <strong className="text-slate-200">Transaction Hash (TXID)</strong>{' '}
                in the verification form.
              </li>
              <li>
                Your account upgrades automatically once the Admin verifies and approves your payment.
              </li>
            </ol>
          </div>
        </section>

        {/* Right: Submit Payment TXID Form */}
        <section className="lg:col-span-7 glass-panel rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">
                Submit Payment Transaction Hash (TXID)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Admin verifies your on-chain LOVA transfer before activating the upgraded level
              </p>
            </div>
          </div>

          {upgradeOptions.length === 0 ? (
            <div className="p-6 rounded-2xl bg-emerald-950/20 border border-emerald-500/30 text-center space-y-2">
              <Crown className="w-8 h-8 text-amber-300 mx-auto" />
              <p className="text-sm font-semibold text-white">Maximum Membership Tier Reached</p>
              <p className="text-xs text-slate-300">
                You have unlocked the highest membership level ({currentMembership.name}). Enjoy your{' '}
                {currentMembership.mining_multiplier.toFixed(2)}x mining boost!
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmitUpgrade} className="space-y-4">
              {pendingRequest && (
                <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/35 text-xs text-amber-200 space-y-1">
                  <p className="font-semibold">
                    Pending Upgrade Under Review: Level {pendingRequest.target_level} (
                    {pendingRequest.required_lova_amount.toLocaleString()} LOVA)
                  </p>
                  <p className="font-mono text-[11px] break-all text-amber-200/80">
                    TXID: {pendingRequest.tx_hash}
                  </p>
                  <p className="text-amber-200/80">
                    Please wait for Admin verification before submitting another upgrade request.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5 text-xs">
                  <span className="text-slate-300 font-medium">Target Membership Level</span>
                  <select
                    value={selectedTier?.level_number || ''}
                    onChange={(e) => setSelectedLevel(Number(e.target.value))}
                    disabled={submitting || Boolean(pendingRequest)}
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#070B17] border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    {upgradeOptions.map((lvl) => (
                      <option key={lvl.level_number} value={lvl.level_number}>
                        Level {lvl.level_number} · {lvl.name} ({lvl.required_lova_amount.toLocaleString()} LOVA)
                      </option>
                    ))}
                  </select>
                </label>

                <div className="p-3 rounded-xl bg-[#070B17] border border-slate-800 flex flex-col justify-center">
                  <span className="text-xs text-slate-400">Required External LOVA Payment</span>
                  <p className="text-lg font-bold font-mono tabular-nums text-blue-300 mt-0.5">
                    {selectedTier ? `${selectedTier.required_lova_amount.toLocaleString()} LOVA` : '—'}
                  </p>
                </div>
              </div>

              <label className="block space-y-1.5 text-xs">
                <span className="text-slate-300 font-medium">
                  Your Sending TON Wallet Address (optional, helps Admin verify faster)
                </span>
                <input
                  type="text"
                  value={senderWallet}
                  onChange={(e) => setSenderWallet(e.target.value)}
                  disabled={submitting || Boolean(pendingRequest)}
                  placeholder="UQ... or EQ... (wallet you sent LOVA from)"
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#070B17] border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                />
              </label>

              <label className="block space-y-1.5 text-xs">
                <span className="text-slate-300 font-medium">
                  Payment Transaction Hash (TXID) <span className="text-rose-400">*</span>
                </span>
                <input
                  type="text"
                  required
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                  disabled={submitting || Boolean(pendingRequest)}
                  placeholder="Paste the TON transaction hash / event ID after transferring LOVA"
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#070B17] border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-[11px] text-slate-400">
                  In-app balance ({user.available_balance.toFixed(2)} LOVA) will{' '}
                  <strong className="text-slate-200">NOT</strong> be deducted.
                </p>

                <button
                  type="submit"
                  disabled={
                    submitting ||
                    Boolean(pendingRequest) ||
                    !adminWallet ||
                    !selectedTier ||
                    txHash.trim().length < 16
                  }
                  className="min-h-[44px] px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
                >
                  <Send className="w-4 h-4" />
                  {submitting ? 'Submitting TXID...' : 'Submit TXID for Verification'}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>

      {/* AVAILABLE MEMBERSHIP LEVELS & UPGRADE BENEFITS */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-white">Available Membership Levels</h2>
            <p className="text-xs text-slate-400">
              Higher levels permanently multiply your LOVA mining speed and daily check-in bonuses
            </p>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {levels.length} Tiers Available
          </span>
        </div>

        {loading && levels.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <div className="h-56 rounded-2xl bg-slate-800/40" />
            <div className="h-56 rounded-2xl bg-slate-800/40" />
            <div className="h-56 rounded-2xl bg-slate-800/40" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {levels.map((lvl) => {
              const isCurrent = lvl.level_number === currentLevelNumber;
              const isUnlocked = lvl.level_number < currentLevelNumber;
              const isSelected = selectedTier?.level_number === lvl.level_number;
              const hasPendingForThis = pendingRequest?.target_level === lvl.level_number;

              return (
                <div
                  key={lvl.level_number}
                  className={`rounded-2xl p-5 flex flex-col justify-between gap-4 border transition-all ${
                    isCurrent
                      ? 'glass-panel-elevated border-emerald-500/45 shadow-[0_0_25px_rgba(16,185,129,0.12)]'
                      : isSelected
                        ? 'glass-panel-elevated border-blue-500/60 shadow-[0_0_25px_rgba(59,130,246,0.16)]'
                        : 'glass-panel border-slate-800/80'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold border ${
                          isCurrent
                            ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                            : isUnlocked
                              ? 'bg-slate-700/40 border-slate-600 text-slate-300'
                              : 'bg-blue-500/15 border-blue-500/35 text-blue-300'
                        }`}
                      >
                        {lvl.badge_label}
                      </span>

                      {isCurrent && (
                        <span className="text-xs font-semibold text-emerald-300 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Current Level
                        </span>
                      )}
                      {isUnlocked && (
                        <span className="text-xs font-medium text-slate-400">Unlocked</span>
                      )}
                      {hasPendingForThis && (
                        <span className="text-xs font-semibold text-amber-300">Pending Review</span>
                      )}
                    </div>

                    <div>
                      <h3 className="text-base font-bold text-white">{lvl.name}</h3>
                      <p className="text-xl font-bold font-mono tabular-nums text-blue-300 mt-1">
                        {lvl.required_lova_amount === 0
                          ? 'Free Default'
                          : `${lvl.required_lova_amount.toLocaleString()} LOVA`}
                      </p>
                      {lvl.required_lova_amount > 0 && (
                        <p className="text-[11px] text-slate-400">External LOVA transfer required</p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2.5 rounded-xl bg-[#070B17] border border-slate-800">
                        <p className="text-[11px] text-slate-400">Mining Boost</p>
                        <p className="font-mono font-semibold text-white mt-0.5">
                          {lvl.mining_multiplier.toFixed(2)}x Speed
                        </p>
                      </div>
                      <div className="p-2.5 rounded-xl bg-[#070B17] border border-slate-800">
                        <p className="text-[11px] text-slate-400">Daily Bonus</p>
                        <p className="font-mono font-semibold text-violet-300 mt-0.5">
                          {lvl.daily_bonus_multiplier.toFixed(2)}x Reward
                        </p>
                      </div>
                    </div>

                    <ul className="space-y-1.5 text-xs text-slate-300 pt-1">
                      {lvl.benefits.map((b, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {!isCurrent && !isUnlocked && (
                    <button
                      type="button"
                      disabled={Boolean(pendingRequest)}
                      onClick={() => {
                        setSelectedLevel(lvl.level_number);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className={`w-full min-h-[42px] px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100'
                      }`}
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      {isSelected
                        ? `Selected (${lvl.required_lova_amount.toLocaleString()} LOVA)`
                        : `Select Level ${lvl.level_number}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* PAYMENT VERIFICATION STATUS HISTORY */}
      <section className="glass-panel rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-white">Upgrade Payment Status</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Track your submitted LOVA transfer hashes (Pending, Approved, or Rejected)
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">{requests.length} requests</span>
        </div>

        {requests.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">
            No level-up payment requests submitted yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {requests.map((req) => (
              <div
                key={req.id}
                className="py-4 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white">
                      Level {req.from_level} → Level {req.target_level}
                      {req.target_level_name ? ` (${req.target_level_name})` : ''}
                    </span>
                    <span className="text-xs font-mono font-semibold text-blue-300">
                      {req.required_lova_amount.toLocaleString()} LOVA
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                    <span className="font-mono break-all">TXID: {req.tx_hash}</span>
                    <a
                      href={`https://tonviewer.com/transaction/${encodeURIComponent(req.tx_hash)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                    >
                      Explorer
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Submitted {new Date(req.created_at).toLocaleString()}
                    {req.reviewed_at ? ` · Reviewed ${new Date(req.reviewed_at).toLocaleString()}` : ''}
                  </p>
                  {req.admin_note && (
                    <p className="text-xs text-slate-300 bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-1.5 mt-1">
                      Admin note: {req.admin_note}
                    </p>
                  )}
                </div>

                <div className="shrink-0">
                  <StatusBadge status={req.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
