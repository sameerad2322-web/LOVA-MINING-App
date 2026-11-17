import { useCallback, useEffect, useState } from 'react';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Crown,
  ExternalLink,
  Home,
  Info,
  ShieldAlert,
  ShieldCheck,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { AdminDashboard } from './components/AdminDashboard';
import { FriendsView } from './components/FriendsView';
import { LevelUpView } from './components/LevelUpView';
import { MiningView } from './components/MiningView';
import { ProfileView } from './components/ProfileView';
import { TasksLeaderboardView } from './components/TasksLeaderboardView';
import { WalletView } from './components/WalletView';
import {
  apiFetch,
  getStoredSessionToken,
  getTelegramWebApp,
  setStoredSessionToken,
} from './lib/api';
import type {
  AuthBootstrapPayload,
  LovaUser,
  MiningSession,
  PublicSystemStatus,
} from './types/lova';

type MainTab = 'home' | 'friends' | 'tasks' | 'levelup' | 'wallet' | 'profile';

const BACKDROP_SRC = '/src/assets/images/lova_atmosphere_1794836081734.jpg';

const FALLBACK_PUBLIC_STATUS: PublicSystemStatus = {
  databaseMode: 'local_preview',
  telegramAuthMode: 'hmac_strict',
  telegramBotConfigured: false,
  telegramBotUsername: null,
  isDemoTokenMode: false,
  isLiveTokenMode: true,
  lovaJettonMasterAddress: null,
  lovaJettonDecimals: 9,
  gramVerificationConfigured: false,
  gramVerificationFee: 0.05,
  gramJettonMasterAddress: null,
  gramJettonDecimals: null,
  adminTonWalletAddress: null,
  tonApiConfigured: false,
  adminBootstrapConfigured: false,
};

function detectAdminRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const pathname = window.location.pathname.replace(/\/+$/, '');
  const params = new URLSearchParams(window.location.search);
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    params.get('admin') === '1' ||
    window.location.hash.startsWith('#/admin')
  );
}

export default function App() {
  const manifestUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/tonconnect-manifest.json`
      : '/tonconnect-manifest.json';

  return (
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <LovaRootRouter />
    </TonConnectUIProvider>
  );
}

function LovaRootRouter() {
  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(() => detectAdminRoute());
  const [toast, setToast] = useState<{
    id: number;
    type: 'success' | 'error' | 'info';
    msg: string;
  } | null>(null);

  useEffect(() => {
    const onPopState = () => {
      setIsAdminRoute(detectAdminRoute());
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onPopState);
    };
  }, []);

  const showToast = useCallback((type: 'success' | 'error' | 'info', msg: string) => {
    const id = Date.now();
    setToast({ id, type, msg });
    window.setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 4500);
  }, []);

  const navigateToWorkerApp = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/');
      setIsAdminRoute(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#060913] text-slate-100 relative overflow-x-hidden">
      {/* Subtle Atmospheric Backdrop */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-35">
        <img
          src={BACKDROP_SRC}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#060913]/40 via-[#060913]/80 to-[#060913]" />
      </div>

      {/* Strictly separated 2-part architecture: Part 2 (Admin Panel Mode on /admin) vs Part 1 (Worker Mode on /) */}
      {isAdminRoute ? (
        <AdminPortalShell onOpenWorkerApp={navigateToWorkerApp} onToast={showToast} />
      ) : (
        <WorkerAppShell onToast={showToast} />
      )}

      {/* Shared Toast Notification */}
      {toast && (
        <div
          role="status"
          className="fixed top-16 right-4 left-4 sm:left-auto sm:w-96 z-50 glass-panel-elevated rounded-2xl p-4 flex items-start gap-3 shadow-2xl"
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          ) : toast.type === 'error' ? (
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          ) : (
            <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          )}
          <p className="text-xs sm:text-sm text-slate-100 leading-snug">{toast.msg}</p>
        </div>
      )}
    </div>
  );
}

/**
 * PART 2: DEDICATED ADMIN PANEL MODE (/admin)
 * Completely independent from Worker Mode navigation, mining UI, and Telegram worker gate.
 */
function AdminPortalShell({
  onOpenWorkerApp,
  onToast,
}: {
  onOpenWorkerApp: () => void;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [publicStatus, setPublicStatus] = useState<PublicSystemStatus>(FALLBACK_PUBLIC_STATUS);

  const fetchPublicStatus = useCallback(async () => {
    try {
      const data = await apiFetch<{ systemStatus: PublicSystemStatus }>('/api/system/public');
      if (data?.systemStatus) {
        setPublicStatus(data.systemStatus);
      }
    } catch {
      // ignore if offline
    }
  }, []);

  useEffect(() => {
    void fetchPublicStatus();
  }, [fetchPublicStatus]);

  return (
    <>
      <header className="sticky top-0 z-30 h-14 lg:h-16 border-b border-slate-800/80 bg-[#060913]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-lg font-display font-bold tracking-tight text-white whitespace-nowrap shrink-0">
              LOVA Admin Panel
            </span>
            <span className="hidden sm:inline text-xs text-slate-400 whitespace-nowrap">
              Management Portal
            </span>
          </div>

          <button
            type="button"
            onClick={onOpenWorkerApp}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
            Open Worker App
          </button>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-12">
        <AdminDashboard
          systemStatus={publicStatus}
          onExit={onOpenWorkerApp}
          onRefreshBootstrap={fetchPublicStatus}
          onToast={onToast}
        />
      </main>
    </>
  );
}

/**
 * PART 1: DEDICATED WORKER MODE (/)
 * Pure miner/worker experience — contains zero Admin links, buttons, or server debug panels.
 */
function WorkerAppShell({
  onToast,
}: {
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [bootstrap, setBootstrap] = useState<AuthBootstrapPayload | null>(null);
  const [publicStatus, setPublicStatus] = useState<PublicSystemStatus>(FALLBACK_PUBLIC_STATUS);
  const [serverTimeOffsetMs, setServerTimeOffsetMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>('home');

  const fetchPublicStatus = useCallback(async () => {
    try {
      const data = await apiFetch<{ systemStatus: PublicSystemStatus }>('/api/system/public');
      if (data?.systemStatus) {
        setPublicStatus(data.systemStatus);
      }
    } catch {
      // ignore if offline
    }
  }, []);

  const authenticateAndLoad = useCallback(async () => {
    try {
      setLoading(true);
      setAuthError(null);

      const tg = getTelegramWebApp();
      if (tg) {
        tg.ready();
        tg.expand();
      }

      const urlParams = new URLSearchParams(window.location.search);
      const refFromUrl = urlParams.get('ref') || urlParams.get('tgWebAppStartParam') || '';
      const initData = tg?.initData || '';
      const startParam = tg?.initDataUnsafe?.start_param || refFromUrl;

      if (!initData && getStoredSessionToken()) {
        try {
          const me = await apiFetch<AuthBootstrapPayload>('/api/auth/me');
          setServerTimeOffsetMs(Date.parse(me.serverTime) - Date.now());
          setBootstrap(me);
          setPublicStatus(me.systemStatus);
          return;
        } catch {
          setStoredSessionToken(null);
        }
      }

      const res = await apiFetch<AuthBootstrapPayload & { sessionToken: string }>(
        '/api/auth/telegram',
        {
          method: 'POST',
          body: JSON.stringify({ initData, startParam }),
        }
      );
      if (res.sessionToken) {
        setStoredSessionToken(res.sessionToken);
      }
      setServerTimeOffsetMs(Date.parse(res.serverTime) - Date.now());
      setBootstrap(res);
      setPublicStatus(res.systemStatus);
    } catch (err) {
      setAuthError((err as Error).message);
      await fetchPublicStatus();
    } finally {
      setLoading(false);
    }
  }, [fetchPublicStatus]);

  const refreshBootstrap = useCallback(async () => {
    try {
      const me = await apiFetch<AuthBootstrapPayload>('/api/auth/me');
      setServerTimeOffsetMs(Date.parse(me.serverTime) - Date.now());
      setBootstrap(me);
      setPublicStatus(me.systemStatus);
    } catch {
      await fetchPublicStatus();
      if (getTelegramWebApp()?.initData) {
        await authenticateAndLoad();
      }
    }
  }, [authenticateAndLoad, fetchPublicStatus]);

  useEffect(() => {
    void authenticateAndLoad();
  }, [authenticateAndLoad]);

  const handleUpdateUserAndSession = useCallback(
    (user: LovaUser, activeSession: MiningSession | null) => {
      setBootstrap((prev) => (prev ? { ...prev, user, activeSession } : prev));
    },
    []
  );

  const navItems: Array<{ id: MainTab; label: string; icon: typeof Home }> = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'friends', label: 'Friends', icon: Users },
    { id: 'tasks', label: 'Tasks', icon: ClipboardList },
    { id: 'levelup', label: 'Level Up', icon: Crown },
    { id: 'wallet', label: 'Wallet', icon: Wallet },
    { id: 'profile', label: 'Profile', icon: User },
  ];

  const effectiveSystemStatus = bootstrap?.systemStatus || publicStatus;
  const isKycVerified = Boolean(
    bootstrap?.activeWallet &&
      bootstrap.activeWallet.is_verified &&
      !bootstrap.activeWallet.is_suspended
  );

  if (loading && !bootstrap) {
    return (
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 rounded-2xl border-2 border-blue-500/40 border-t-blue-400 animate-spin mb-4" />
        <p className="text-sm font-medium text-slate-200">Initializing LOVA Worker Session...</p>
        <p className="text-xs text-slate-500 mt-1">Verifying Telegram &amp; TON session state</p>
      </div>
    );
  }

  if (!bootstrap) {
    const botLink = effectiveSystemStatus.telegramBotUsername
      ? `https://t.me/${effectiveSystemStatus.telegramBotUsername}`
      : null;

    return (
      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="h-14 lg:h-16 border-b border-slate-800/80 bg-[#060913]/85 backdrop-blur-md">
          <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
            <span className="text-lg font-display font-bold tracking-tight text-white whitespace-nowrap">
              LOVA Mining
            </span>
            <span className="text-xs text-slate-400 whitespace-nowrap">TON Network</span>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center p-6">
          <div className="glass-panel rounded-3xl p-8 max-w-md w-full text-center space-y-5">
            <AlertCircle className="w-10 h-10 text-blue-400 mx-auto" />
            <div className="space-y-2">
              <h1 className="text-xl font-bold text-white">Open LOVA Mining in Telegram</h1>
              <p className="text-sm text-slate-300 leading-relaxed">
                {authError || 'Please launch LOVA Mining inside Telegram to authenticate securely.'}
              </p>
            </div>
            <div className="space-y-2.5">
              {botLink && (
                <a
                  href={botLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                >
                  Open @{effectiveSystemStatus.telegramBotUsername}
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
              <button
                type="button"
                onClick={() => void authenticateAndLoad()}
                className="w-full min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-sm font-semibold transition-colors"
              >
                Retry Connection
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Desktop & Mobile Top Navigation Header (Strictly 3-zone contract) */}
      <header className="sticky top-0 z-30 h-14 lg:h-16 border-b border-slate-800/80 bg-[#060913]/85 backdrop-blur-md">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="text-lg font-display font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            LOVA Mining
          </button>

          {/* Zone 2: Desktop Single-line Nav Links */}
          <nav className="hidden lg:flex items-center gap-7 text-sm font-medium">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                    active
                      ? 'text-white border-blue-500'
                      : 'text-slate-400 border-transparent hover:text-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single Primary KYC / Wallet Action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('wallet')}
              className={`px-3.5 py-2 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                isKycVerified
                  ? 'bg-emerald-500/10 hover:bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-blue-600/15 hover:bg-blue-600/25 border-blue-500/35 text-blue-200'
              }`}
            >
              {isKycVerified ? (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              )}
              {isKycVerified ? 'KYC Verified' : 'Verify 0.05 GRAM'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Worker Content Container */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-24 lg:pb-12">
        {activeTab === 'home' && (
          <MiningView
            user={bootstrap.user}
            activeSession={bootstrap.activeSession}
            settings={bootstrap.settings}
            announcements={bootstrap.announcements}
            systemStatus={bootstrap.systemStatus}
            currentMembership={bootstrap.currentMembership}
            serverTimeOffsetMs={serverTimeOffsetMs}
            canCheckInToday={bootstrap.canCheckInToday}
            onOpenLevelUp={() => setActiveTab('levelup')}
            onRefreshBootstrap={refreshBootstrap}
            onUpdateUserAndSession={handleUpdateUserAndSession}
            onToast={onToast}
          />
        )}

        {activeTab === 'friends' && <FriendsView onToast={onToast} />}

        {activeTab === 'tasks' && (
          <TasksLeaderboardView
            user={bootstrap.user}
            settings={bootstrap.settings}
            canCheckInToday={bootstrap.canCheckInToday}
            onRefreshBootstrap={refreshBootstrap}
            onToast={onToast}
          />
        )}

        {activeTab === 'levelup' && (
          <LevelUpView
            user={bootstrap.user}
            activeWallet={bootstrap.activeWallet}
            systemStatus={bootstrap.systemStatus}
            initialLevels={bootstrap.membershipLevels}
            onRefreshBootstrap={refreshBootstrap}
            onToast={onToast}
          />
        )}

        {activeTab === 'wallet' && (
          <WalletView
            user={bootstrap.user}
            activeWallet={bootstrap.activeWallet}
            settings={bootstrap.settings}
            systemStatus={bootstrap.systemStatus}
            onRefreshBootstrap={refreshBootstrap}
            onToast={onToast}
          />
        )}

        {activeTab === 'profile' && (
          <ProfileView
            user={bootstrap.user}
            activeWallet={bootstrap.activeWallet}
            currentMembership={bootstrap.currentMembership}
            onOpenWallet={() => setActiveTab('wallet')}
            onOpenLevelUp={() => setActiveTab('levelup')}
            onRefreshBootstrap={refreshBootstrap}
          />
        )}
      </main>

      {/* Mobile Fixed 6-Tab Bottom Navigation (<1024px) */}
      <nav
        aria-label="Primary Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-[#070B17]/95 backdrop-blur-md border-t border-slate-800/90 grid grid-cols-6 items-center"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 px-0.5 transition-colors ${
                active ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="text-[10px] font-medium tracking-tight whitespace-nowrap">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
