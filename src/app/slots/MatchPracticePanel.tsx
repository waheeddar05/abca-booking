'use client';

/**
 * Match Practice booking panel — rendered by ResourceSlotsPage when the
 * user picks the "Match Practice" category tab.
 *
 * Two subcategories, both seat-based (no machine / ball / pitch /
 * operator / time-slot pickers anywhere):
 *
 *   Corporate Batch
 *     - Monthly (or Half-Month when enabled): pick a month → see
 *       "18 of 25 members enrolled" → pay the flat monthly fee.
 *     - Regular Session: pick one or more upcoming batch dates → see
 *       "12 of 25 seats booked" per session → pay per session.
 *
 *   Match Simulation
 *     - Pick one or more upcoming sessions (multiple per day supported)
 *       → see "2 of 10 slots booked" → pay the per-session fee.
 *
 * Payment mirrors the main slots flow exactly: wallet-covers-all POSTs
 * directly with paymentMethod=WALLET, "pay at center" POSTs with CASH,
 * anything else goes through Razorpay with the booking payload attached
 * so /api/payments/verify creates the seats atomically after capture.
 */

import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  AlertTriangle,
  Calendar,
  Check,
  IndianRupee,
  Loader2,
  Trophy,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PaymentMethodSelector } from '@/components/ui/PaymentMethodSelector';
import { api } from '@/lib/api-client';
import { useRazorpay } from '@/lib/useRazorpay';
import { DEFAULT_BOOKING_NOTICE } from '@/lib/client-constants';

// ─── API shapes (mirror /api/match-practice/availability) ────────────

interface HalfMonthInfo {
  enabled: boolean;
  fee: number;
  firstHalf: boolean;
  secondHalf: boolean;
  splitDay: number;
}

interface EnrollSlot {
  date: string;
  startTime: string;
  endTime: string;
}

interface MonthOption {
  period: string;
  label: string;
  fee: number;
  enrolled: number;
  capacity: number;
  isFull: boolean;
  startsOn: string;
  slot: EnrollSlot;
  halves?: MonthOption[];
}

interface CorporateSessionInfo {
  date: string;
  dayLabel: string;
  startTime: string;
  endTime: string;
  fee: number;
  seatsBooked: number;
  capacity: number;
  remaining: number;
  isFull: boolean;
}

interface SimSessionInfo {
  sessionId: string;
  label: string;
  coachName: string | null;
  date: string;
  dayLabel: string;
  startTime: string;
  endTime: string;
  fee: number;
  booked: number;
  capacity: number;
  remaining: number;
  isFull: boolean;
}

/** A match-simulation session that offers a Monthly (and optionally
 *  half-month) pass, with its enrollable months. */
interface SimMonthlySession {
  sessionId: string;
  label: string;
  coachName: string | null;
  days: number[];
  startTime: string; // "HH:MM" IST
  endTime: string;   // "HH:MM" IST
  monthlyFee: number;
  capacity: number;
  halfMonth: HalfMonthInfo;
  months: MonthOption[];
}

interface MatchPracticeAvailability {
  centerId: string;
  corporateBatch: {
    enabled: boolean;
    days: number[];
    startTime: string;
    endTime: string;
    coachName: string | null;
    monthlyFee: number;
    regularFee: number;
    maxCapacity: number;
    halfMonth: HalfMonthInfo;
    months: MonthOption[];
    sessions: CorporateSessionInfo[];
  };
  matchSimulation: {
    enabled: boolean;
    sessions: SimSessionInfo[];
    monthly: {
      enabled: boolean;
      sessions: SimMonthlySession[];
    };
  };
}

interface PaymentConfigLite {
  paymentEnabled: boolean;
  slotPaymentRequired: boolean;
  cashPaymentEnabled: boolean;
  walletEnabled: boolean;
  /** Red facility rule for the confirmation dialog. `''` = center turned
   *  it off; absent = fall back to `DEFAULT_BOOKING_NOTICE`. */
  bookingNotice?: string;
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDays(days: number[]): string {
  return [...days].sort((a, b) => a - b).map((d) => DAY_SHORT[d] ?? '').filter(Boolean).join(', ');
}

function formatTimeIST(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

/** "07:00" → "7:00 AM" without needing a date. */
function formatHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${(m ?? 0).toString().padStart(2, '0')} ${suffix}`;
}

const sessionKey = (date: string, startTime: string) => `${date}|${startTime}`;

export default function MatchPracticePanel({
  playerName,
  userEmail,
  isFreeBooking,
  paymentConfig,
}: {
  playerName: string;
  userEmail?: string | null;
  isFreeBooking: boolean;
  paymentConfig: PaymentConfigLite | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [data, setData] = useState<MatchPracticeAvailability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  type Sub = 'CORPORATE' | 'SIMULATION';
  const [sub, setSub] = useState<Sub | null>(null);
  // Booking Option defaults to Regular (per-day session) for both
  // subcategories — see the landing default in the fetch below.
  const [corpMode, setCorpMode] = useState<'MONTHLY' | 'REGULAR'>('REGULAR');
  /** Selected enrollment period — a month ("2026-07") or a half
   *  ("2026-07-H1"). Only one enrollment at a time. */
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  /** Which month card is expanded (relevant when half-month is on). */
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [selectedRegular, setSelectedRegular] = useState<Set<string>>(new Set());
  const [selectedSim, setSelectedSim] = useState<Set<string>>(new Set());
  // ── Match Simulation Monthly / Regular ──────────────────────────────
  const [simMode, setSimMode] = useState<'MONTHLY' | 'REGULAR'>('REGULAR');
  /** Which monthly-enabled sim session the user is enrolling in. */
  const [selectedSimSessionId, setSelectedSimSessionId] = useState<string | null>(null);
  /** Selected sim enrollment period (month or half). */
  const [selectedSimPeriod, setSelectedSimPeriod] = useState<string | null>(null);
  /** Which sim month card is expanded (half-month splits). */
  const [expandedSimMonth, setExpandedSimMonth] = useState<string | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<'ONLINE' | 'CASH'>('ONLINE');
  const [useWallet, setUseWallet] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const { initiatePayment, processing: paymentProcessing } = useRazorpay(
    { onFailure: (msg) => toast.error(msg) },
    !!paymentConfig?.paymentEnabled,
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get<MatchPracticeAvailability>('/api/match-practice/availability')
      .then((res) => {
        setData(res);
        // Land on Match Simulation — the default session type — falling back
        // to Corporate Batch when simulation is the one that's turned off.
        // Paired with the Regular (per-day) Booking Option defaults above, a
        // user who taps Match Practice arrives on a ready-to-book state and
        // only has to pick a session.
        setSub(res.matchSimulation.enabled ? 'SIMULATION' : res.corporateBatch.enabled ? 'CORPORATE' : null);
        // Default the monthly enrollment to the first session that offers it.
        setSelectedSimSessionId(res.matchSimulation.monthly?.sessions[0]?.sessionId ?? null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load match practice sessions'))
      .finally(() => setLoading(false));
  }, []);

  // Clear cross-flow selections when the user switches subcategory/mode.
  useEffect(() => {
    setSelectedPeriod(null);
    setExpandedMonth(null);
    setSelectedRegular(new Set());
    setSelectedSim(new Set());
    setSelectedSimPeriod(null);
    setExpandedSimMonth(null);
  }, [sub, corpMode, simMode]);

  // Reset the picked month when the user switches which sim session they're
  // enrolling in.
  useEffect(() => {
    setSelectedSimPeriod(null);
    setExpandedSimMonth(null);
  }, [selectedSimSessionId]);

  // Snap back to ONLINE when the center disables cash mid-session.
  useEffect(() => {
    if (paymentConfig && !paymentConfig.cashPaymentEnabled && paymentMethod === 'CASH') {
      setPaymentMethod('ONLINE');
    }
  }, [paymentConfig, paymentMethod]);

  // ─── Selection → booking body ─────────────────────────────────────

  const selectedMonthOption = useMemo((): MonthOption | null => {
    if (!data || !selectedPeriod) return null;
    for (const m of data.corporateBatch.months) {
      if (m.period === selectedPeriod) return m;
      const half = m.halves?.find((h) => h.period === selectedPeriod);
      if (half) return half;
    }
    return null;
  }, [data, selectedPeriod]);

  const selectedRegularSessions = useMemo(
    () => (data?.corporateBatch.sessions ?? []).filter((s) => selectedRegular.has(sessionKey(s.date, s.startTime))),
    [data, selectedRegular],
  );

  const selectedSimSessions = useMemo(
    () => (data?.matchSimulation.sessions ?? []).filter((s) => selectedSim.has(sessionKey(s.date, s.startTime))),
    [data, selectedSim],
  );

  const simMonthlySessions = useMemo(
    () => data?.matchSimulation.monthly?.sessions ?? [],
    [data],
  );
  const simMonthlyEnabled = !!data?.matchSimulation.monthly?.enabled;
  /** Match Simulation is in monthly mode only when it's actually offered. */
  const effectiveSimMode: 'MONTHLY' | 'REGULAR' = simMonthlyEnabled ? simMode : 'REGULAR';

  const selectedSimSession = useMemo(
    () => data?.matchSimulation.monthly?.sessions.find((s) => s.sessionId === selectedSimSessionId) ?? null,
    [data, selectedSimSessionId],
  );
  const selectedSimMonthOption = useMemo((): MonthOption | null => {
    if (!selectedSimSession || !selectedSimPeriod) return null;
    for (const m of selectedSimSession.months) {
      if (m.period === selectedSimPeriod) return m;
      const half = m.halves?.find((h) => h.period === selectedSimPeriod);
      if (half) return half;
    }
    return null;
  }, [selectedSimSession, selectedSimPeriod]);

  const selection = useMemo((): {
    count: number;
    total: number;
    summary: string;
    body: Record<string, unknown> | null;
    slots: EnrollSlot[];
  } => {
    if (sub === 'CORPORATE' && corpMode === 'MONTHLY') {
      if (!selectedMonthOption) return { count: 0, total: 0, summary: '', body: null, slots: [] };
      const slots = [selectedMonthOption.slot];
      return {
        count: 1,
        total: selectedMonthOption.fee,
        summary: `Corporate Batch · ${selectedMonthOption.label}`,
        slots,
        body: {
          slots,
          category: 'CORPORATE_BATCH',
          playerName,
          corporateMode: selectedMonthOption.period.includes('-H') ? 'HALF_MONTH' : 'MONTHLY',
          enrollmentPeriod: selectedMonthOption.period,
        },
      };
    }
    if (sub === 'CORPORATE' && corpMode === 'REGULAR') {
      if (selectedRegularSessions.length === 0) return { count: 0, total: 0, summary: '', body: null, slots: [] };
      const slots = selectedRegularSessions.map((s) => ({ date: s.date, startTime: s.startTime, endTime: s.endTime }));
      return {
        count: slots.length,
        total: selectedRegularSessions.reduce((sum, s) => sum + s.fee, 0),
        summary: `Corporate Batch · ${slots.length} session${slots.length === 1 ? '' : 's'}`,
        slots,
        body: {
          slots,
          category: 'CORPORATE_BATCH',
          playerName,
          corporateMode: 'REGULAR',
        },
      };
    }
    if (sub === 'SIMULATION' && effectiveSimMode === 'MONTHLY') {
      if (!selectedSimSession || !selectedSimMonthOption) return { count: 0, total: 0, summary: '', body: null, slots: [] };
      const slots = [selectedSimMonthOption.slot];
      return {
        count: 1,
        total: selectedSimMonthOption.fee,
        summary: `Match Simulation · ${selectedSimSession.label ? `${selectedSimSession.label} · ` : ''}${selectedSimMonthOption.label}`,
        slots,
        body: {
          slots,
          category: 'MATCH_SIMULATION',
          playerName,
          corporateMode: selectedSimMonthOption.period.includes('-H') ? 'HALF_MONTH' : 'MONTHLY',
          enrollmentPeriod: selectedSimMonthOption.period,
          matchSimSessionId: selectedSimSession.sessionId,
        },
      };
    }
    if (sub === 'SIMULATION') {
      if (selectedSimSessions.length === 0) return { count: 0, total: 0, summary: '', body: null, slots: [] };
      const slots = selectedSimSessions.map((s) => ({ date: s.date, startTime: s.startTime, endTime: s.endTime }));
      return {
        count: slots.length,
        total: selectedSimSessions.reduce((sum, s) => sum + s.fee, 0),
        summary: `Match Simulation · ${slots.length} session${slots.length === 1 ? '' : 's'}`,
        slots,
        body: {
          slots,
          category: 'MATCH_SIMULATION',
          playerName,
        },
      };
    }
    return { count: 0, total: 0, summary: '', body: null, slots: [] };
  }, [sub, corpMode, effectiveSimMode, selectedMonthOption, selectedRegularSessions, selectedSimSessions, selectedSimSession, selectedSimMonthOption, playerName]);

  // ─── Submit (mirrors ResourceSlotsPage.submit payment routing) ─────

  const submit = async () => {
    if (!selection.body) return;
    setSubmitting(true);
    try {
      const isCashPayment = paymentMethod === 'CASH';
      const grandTotal = isFreeBooking ? 0 : selection.total;
      const walletDeduction = useWallet && walletBalance > 0
        ? Math.min(walletBalance, grandTotal)
        : 0;
      const amountAfterWallet = Math.max(0, grandTotal - walletDeduction);
      const walletCoversAll = !isFreeBooking && walletDeduction > 0 && amountAfterWallet === 0;

      const body: Record<string, unknown> = {
        ...selection.body,
        ...(walletCoversAll
          ? { paymentMethod: 'WALLET' as const, walletDeduction }
          : isCashPayment
            ? { paymentMethod: 'CASH' as const, ...(walletDeduction > 0 ? { walletDeduction } : {}) }
            : walletDeduction > 0
              ? { walletDeduction }
              : {}),
      };

      const requiresOnlinePayment =
        !!paymentConfig?.paymentEnabled &&
        !!paymentConfig?.slotPaymentRequired &&
        !isFreeBooking &&
        !isCashPayment &&
        !walletCoversAll &&
        amountAfterWallet > 0;

      if (requiresOnlinePayment) {
        const paymentResult = await initiatePayment({
          type: 'SLOT_BOOKING',
          amount: amountAfterWallet,
          slots: selection.slots,
          walletDeduction: walletDeduction > 0 ? walletDeduction : undefined,
          bookingPayload: [body],
          description: selection.summary,
          prefill: { name: playerName || undefined, email: userEmail || undefined },
        });
        if (!paymentResult) return;
        if (!paymentResult.bookings || paymentResult.bookings.length === 0) {
          toast.error(
            'Payment captured but no booking was created. Our team has been notified. Please contact admin.',
          );
          return;
        }
        toast.success('Payment successful! Your seat is booked.');
        router.push('/bookings');
        return;
      }

      await api.post('/api/slots/book-resource', body);
      toast.success(
        isCashPayment
          ? walletDeduction > 0
            ? `Booking confirmed! ₹${walletDeduction} from wallet. Pay ₹${amountAfterWallet} at center.`
            : 'Booking confirmed! Pay at center when you arrive.'
          : walletCoversAll
            ? 'Booking confirmed! Payment deducted from wallet.'
            : 'Booking confirmed!',
      );
      router.push('/bookings');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Booking failed');
    } finally {
      setSubmitting(false);
      setShowConfirm(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-white/[0.03] animate-pulse" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
      </div>
    );
  }
  if (!data || (!data.corporateBatch.enabled && !data.matchSimulation.enabled)) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
        <Trophy className="w-8 h-8 text-slate-600 mx-auto mb-2" />
        <p className="text-xs text-slate-400">
          Match practice isn&apos;t available at this center yet. Please check back later.
        </p>
      </div>
    );
  }

  const cb = data.corporateBatch;
  const ms = data.matchSimulation;

  // Session Type options — only the ones the center has enabled. The box is
  // shown whenever there is at least one (the both-disabled case already
  // returned the "not available" state above), so a user always sees which
  // session type they are booking, even when it's the only one on offer.
  const subOptions = [
    { key: 'SIMULATION' as Sub, label: 'Match Simulation', icon: Trophy, enabled: ms.enabled },
    { key: 'CORPORATE' as Sub, label: 'Corporate Batch', icon: Users, enabled: cb.enabled },
  ].filter((o) => o.enabled);

  const showPaymentSelector =
    selection.count > 0
    && !isFreeBooking
    && selection.total > 0
    && (
      (paymentConfig?.paymentEnabled && paymentConfig?.slotPaymentRequired)
      || paymentConfig?.cashPaymentEnabled
      || paymentConfig?.walletEnabled
    );

  // Confirm-dialog breakdown (mirrors the main page's dialog copy).
  const dialogGrand = isFreeBooking ? 0 : selection.total;
  const dialogWallet = useWallet && walletBalance > 0 ? Math.min(walletBalance, dialogGrand) : 0;
  const dialogAfterWallet = Math.max(0, dialogGrand - dialogWallet);
  const dialogWalletCoversAll = !isFreeBooking && dialogWallet > 0 && dialogAfterWallet === 0;
  const dialogRequiresOnline =
    !!paymentConfig?.paymentEnabled
    && !!paymentConfig?.slotPaymentRequired
    && !isFreeBooking
    && paymentMethod !== 'CASH'
    && !dialogWalletCoversAll
    && dialogAfterWallet > 0;
  const confirmLines = [selection.summary];
  if (isFreeBooking) {
    confirmLines.push('Total: FREE');
  } else if (dialogWalletCoversAll) {
    confirmLines.push(`Total: ₹${dialogGrand} (Wallet — ₹${dialogWallet} deducted)`);
  } else if (dialogWallet > 0 && paymentMethod === 'CASH') {
    confirmLines.push(`₹${dialogWallet} from wallet · ₹${dialogAfterWallet} at center`);
  } else if (dialogWallet > 0) {
    confirmLines.push(`₹${dialogWallet} from wallet · ₹${dialogAfterWallet} online`);
  } else if (paymentMethod === 'CASH') {
    confirmLines.push(`Total: ₹${dialogGrand} (Pay at center)`);
  } else {
    confirmLines.push(`Total: ₹${dialogGrand}`);
  }

  return (
    <div>
      {/* Session Type. Always rendered while at least one type is enabled —
          with only one, it stays as a single (selected) tile so the user can
          still see what they're booking. */}
      {subOptions.length > 0 && (
        <div className="mb-4">
          <label className="block text-[10px] font-medium text-accent mb-1 uppercase tracking-wider">
            Session Type
          </label>
          <div className={`grid gap-1.5 ${subOptions.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {subOptions.map(({ key, label, icon: Icon }) => {
              const active = sub === key;
              return (
                <button
                  key={key}
                  onClick={() => setSub(key)}
                  className={`flex items-center justify-start gap-2 px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all cursor-pointer min-w-0 text-left border ${
                    active
                      ? 'bg-accent text-primary border-accent shadow-sm'
                      : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:border-accent/20'
                  }`}
                >
                  <div className={`w-5 h-5 sm:w-6 sm:h-6 rounded-md flex items-center justify-center flex-shrink-0 ${
                    active ? 'bg-primary/15' : 'bg-white/[0.04]'
                  }`}>
                    <Icon className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${active ? 'text-primary' : 'text-accent'}`} />
                  </div>
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Corporate Batch ──────────────────────────────────────── */}
      {sub === 'CORPORATE' && cb.enabled && (
        <div>
          {/* Batch info strip — schedule/frequency on the first line, coach
              always on its own line below. */}
          <div className="mb-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[11px] text-slate-400 leading-relaxed">
            <div>
              <span className="text-slate-300 font-semibold">{formatDays(cb.days)}</span>
              {' · '}{formatHHMM(cb.startTime)} – {formatHHMM(cb.endTime)}
              {' · '}{cb.days.length} day{cb.days.length === 1 ? '' : 's'}/week
            </div>
            {cb.coachName && (
              <div className="mt-1">
                Coach: <span className="text-slate-300 font-semibold">{cb.coachName}</span>
              </div>
            )}
          </div>

          {/* Monthly / Regular toggle */}
          <div className="mb-4">
            <label className="block text-[10px] font-medium text-accent mb-1 uppercase tracking-wider">
              Booking Option
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { key: 'MONTHLY' as const, label: 'Monthly', sub2: `₹${(Number(cb.monthlyFee) || 0).toLocaleString()}/month` },
                { key: 'REGULAR' as const, label: 'Regular', sub2: `₹${(Number(cb.regularFee) || 0).toLocaleString()}/session` },
              ]).map(({ key, label, sub2 }) => {
                const active = corpMode === key;
                return (
                  <button
                    key={key}
                    onClick={() => setCorpMode(key)}
                    className={`px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-lg text-left border transition-all cursor-pointer ${
                      active
                        ? 'bg-accent text-primary border-accent shadow-sm'
                        : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:border-accent/20'
                    }`}
                  >
                    <span className="block text-[11px] sm:text-xs font-semibold">{label}</span>
                    <span className={`block text-[10px] ${active ? 'text-primary/70' : 'text-slate-500'}`}>{sub2}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {corpMode === 'MONTHLY' && (
            <div className="mb-5">
              <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
                Select Month
              </label>
              {cb.months.length === 0 ? (
                <EmptyState text="No months are open for enrollment right now." />
              ) : (
                <MonthCardGrid
                  months={cb.months}
                  selectedPeriod={selectedPeriod}
                  expandedMonth={expandedMonth}
                  onSelectPeriod={setSelectedPeriod}
                  onExpandMonth={setExpandedMonth}
                />
              )}
            </div>
          )}

          {corpMode === 'REGULAR' && (
            <div className="mb-5">
              <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
                Upcoming Sessions
              </label>
              {cb.sessions.length === 0 ? (
                <EmptyState text="No upcoming corporate batch sessions." />
              ) : (
                <SessionCardGrid
                  items={cb.sessions.map((s) => ({
                    key: sessionKey(s.date, s.startTime),
                    date: s.date,
                    dayLabel: s.dayLabel,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    title: null,
                    coach: null,
                    fee: s.fee,
                    booked: s.seatsBooked,
                    capacity: s.capacity,
                    isFull: s.isFull,
                    seatNoun: 'seats',
                  }))}
                  selected={selectedRegular}
                  onToggle={(key) => {
                    setSelectedRegular((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key); else next.add(key);
                      return next;
                    });
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── Match Simulation ─────────────────────────────────────── */}
      {sub === 'SIMULATION' && ms.enabled && (
        <div>
          {/* Monthly / Regular toggle — shown only when at least one
              session offers a monthly pass. Otherwise the flow is the
              original per-session (regular) picker, untouched. */}
          {simMonthlyEnabled && (
            <div className="mb-4">
              <label className="block text-[10px] font-medium text-accent mb-1 uppercase tracking-wider">
                Booking Option
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { key: 'MONTHLY' as const, label: 'Monthly', sub2: 'Full-month pass' },
                  { key: 'REGULAR' as const, label: 'Regular', sub2: 'Pay per session' },
                ]).map(({ key, label, sub2 }) => {
                  const active = effectiveSimMode === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setSimMode(key)}
                      className={`px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-lg text-left border transition-all cursor-pointer ${
                        active
                          ? 'bg-accent text-primary border-accent shadow-sm'
                          : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:border-accent/20'
                      }`}
                    >
                      <span className="block text-[11px] sm:text-xs font-semibold">{label}</span>
                      <span className={`block text-[10px] ${active ? 'text-primary/70' : 'text-slate-500'}`}>{sub2}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {effectiveSimMode === 'MONTHLY' ? (
            <div className="mb-5 space-y-4">
              {/* Session picker — shown when more than one session offers a
                  monthly pass. Each monthly pass is tied to one session. */}
              {simMonthlySessions.length > 1 && (
                <div>
                  <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
                    Select Session
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {simMonthlySessions.map((s) => {
                      const active = selectedSimSessionId === s.sessionId;
                      return (
                        <button
                          key={s.sessionId}
                          onClick={() => setSelectedSimSessionId(s.sessionId)}
                          className={`px-2.5 py-2 rounded-lg text-left border transition-all cursor-pointer ${
                            active
                              ? 'bg-accent text-primary border-accent shadow-sm'
                              : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:border-accent/20'
                          }`}
                        >
                          <span className="block text-[11px] sm:text-xs font-semibold truncate">
                            {s.label || 'Match Simulation'}
                          </span>
                          <span className={`block text-[10px] ${active ? 'text-primary/70' : 'text-slate-500'}`}>
                            {formatDays(s.days)} · {formatHHMM(s.startTime)}–{formatHHMM(s.endTime)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedSimSession && (
                <div>
                  {/* Session info strip — mirrors the corporate batch strip. */}
                  <div className="mb-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[11px] text-slate-400 leading-relaxed">
                    <div>
                      <span className="text-slate-300 font-semibold">{formatDays(selectedSimSession.days)}</span>
                      {' · '}{formatHHMM(selectedSimSession.startTime)} – {formatHHMM(selectedSimSession.endTime)}
                      {' · '}₹{(Number(selectedSimSession.monthlyFee) || 0).toLocaleString()}/month
                    </div>
                    {selectedSimSession.coachName && (
                      <div className="mt-1">
                        Coach: <span className="text-slate-300 font-semibold">{selectedSimSession.coachName}</span>
                      </div>
                    )}
                  </div>
                  <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
                    Select Month
                  </label>
                  {selectedSimSession.months.length === 0 ? (
                    <EmptyState text="No months are open for enrollment right now." />
                  ) : (
                    <MonthCardGrid
                      months={selectedSimSession.months}
                      selectedPeriod={selectedSimPeriod}
                      expandedMonth={expandedSimMonth}
                      onSelectPeriod={setSelectedSimPeriod}
                      onExpandMonth={setExpandedSimMonth}
                    />
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="mb-5">
              <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
                Upcoming Sessions
              </label>
              {ms.sessions.length === 0 ? (
                <EmptyState text="No upcoming match simulation sessions." />
              ) : (
                <SessionCardGrid
                  items={ms.sessions.map((s) => ({
                    key: sessionKey(s.date, s.startTime),
                    date: s.date,
                    dayLabel: s.dayLabel,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    title: s.label || null,
                    coach: s.coachName,
                    fee: s.fee,
                    booked: s.booked,
                    capacity: s.capacity,
                    isFull: s.isFull,
                    seatNoun: 'slots',
                  }))}
                  selected={selectedSim}
                  onToggle={(key) => {
                    setSelectedSim((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key); else next.add(key);
                      return next;
                    });
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Payment method (online / cash / wallet) */}
      {showPaymentSelector && (
        <div className="mb-4">
          <p className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Payment</p>
          <PaymentMethodSelector
            selected={paymentMethod}
            onChange={setPaymentMethod}
            disabled={submitting || paymentProcessing}
            showOnline={!!(paymentConfig?.paymentEnabled && paymentConfig?.slotPaymentRequired)}
            showCash={paymentConfig?.cashPaymentEnabled}
            showWallet={paymentConfig?.walletEnabled}
            totalAmount={selection.total}
            useWallet={useWallet}
            onUseWalletChange={setUseWallet}
            onWalletBalanceLoaded={setWalletBalance}
          />
        </div>
      )}

      <ConfirmDialog
        open={showConfirm}
        title="Confirm Booking"
        message={confirmLines.join('\n')}
        notice={
          paymentConfig
            ? paymentConfig.bookingNotice ?? DEFAULT_BOOKING_NOTICE
            : DEFAULT_BOOKING_NOTICE
        }
        confirmLabel={
          dialogRequiresOnline
            ? `Pay ₹${dialogAfterWallet.toLocaleString()}`
            : dialogWalletCoversAll
              ? 'Confirm (Wallet)'
              : 'Confirm Booking'
        }
        cancelLabel="Go Back"
        onCancel={() => setShowConfirm(false)}
        onConfirm={submit}
        loading={submitting || paymentProcessing}
      />

      {/* Sticky booking bar — same treatment as the main slot flow. */}
      {selection.count > 0 && (
        <div className="fixed bottom-0 md:bottom-0 left-0 right-0 bg-[#0f1d2f]/95 backdrop-blur-md border-t border-white/[0.08] p-4 z-40 mb-[60px] md:mb-0 safe-bottom">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">{selection.summary}</p>
              <div className="flex items-center gap-1 mt-0.5">
                {isFreeBooking ? (
                  <span className="text-sm font-bold text-emerald-400 uppercase tracking-wider">
                    Free booking
                  </span>
                ) : (
                  <>
                    <IndianRupee className="w-3 h-3 text-accent" />
                    <span className="text-sm font-bold text-accent">
                      {selection.total.toLocaleString()}
                    </span>
                  </>
                )}
              </div>
            </div>
            <button
              onClick={() => setShowConfirm(true)}
              disabled={submitting || paymentProcessing}
              className="flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-6 py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.97] disabled:opacity-50 cursor-pointer"
            >
              {submitting || paymentProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {paymentProcessing ? 'Processing payment...' : 'Booking...'}
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Confirm
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center">
      <Calendar className="w-6 h-6 text-slate-600 mx-auto mb-2" />
      <p className="text-xs text-slate-400">{text}</p>
    </div>
  );
}

/**
 * Month enrollment cards — one solid-fill card per enrollable month. A
 * month with no `halves` is a single toggle button; a month that carries
 * half-month splits expands into Full Month / First Half / Second Half
 * options. Single source of truth for both the Corporate Batch and Match
 * Simulation monthly flows so they stay pixel-identical.
 */
function MonthCardGrid({
  months,
  selectedPeriod,
  expandedMonth,
  onSelectPeriod,
  onExpandMonth,
}: {
  months: MonthOption[];
  selectedPeriod: string | null;
  expandedMonth: string | null;
  onSelectPeriod: (period: string | null) => void;
  onExpandMonth: (period: string | null) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {months.map((m) => {
        const hasHalves = (m.halves?.length ?? 0) > 0;
        const activeMonth =
          selectedPeriod === m.period
          || !!m.halves?.some((h) => h.period === selectedPeriod);
        const monthSelected = selectedPeriod === m.period;
        const shortLabel = m.label.replace(/ · .*/, '');

        // Common case (no half-month split): the whole card is a single
        // button that fills solid accent when selected.
        if (!hasHalves) {
          return (
            <button
              key={m.period}
              disabled={m.isFull}
              onClick={() => onSelectPeriod(monthSelected ? null : m.period)}
              className={`relative px-2.5 py-2 rounded-lg border text-left transition-all ${
                m.isFull
                  ? 'bg-white/[0.02] border-white/[0.05] cursor-not-allowed opacity-60'
                  : monthSelected
                    ? 'bg-accent text-primary border-accent shadow-md shadow-accent/20 cursor-pointer'
                    : 'bg-white/[0.04] border-white/[0.08] hover:border-accent/40 active:scale-[0.98] cursor-pointer'
              }`}
            >
              {monthSelected && (
                <div className="absolute top-1.5 right-1.5">
                  <Check className="w-3.5 h-3.5" />
                </div>
              )}
              <div className="flex items-center justify-between gap-1 pr-4">
                <p className={`text-xs font-bold truncate ${m.isFull ? 'text-slate-500' : monthSelected ? '' : 'text-white'}`}>
                  {shortLabel}
                </p>
                <span className={`text-[10px] font-bold flex-shrink-0 ${monthSelected ? 'text-primary/80' : 'text-accent'}`}>
                  ₹{(Number(m.fee) || 0).toLocaleString()}
                </span>
              </div>
              <p className={`text-[10px] mt-0.5 ${monthSelected ? 'text-primary/70' : 'text-slate-400'}`}>
                <Users className="w-3 h-3 inline mr-1 -mt-0.5" />
                {m.enrolled}/{m.capacity} enrolled
                {m.isFull && <span className="font-semibold ml-1 text-red-400">· Full</span>}
              </p>
            </button>
          );
        }

        // Half-month split available: expandable card. The header fills
        // accent when the full month is picked; each split option fills
        // when selected.
        return (
          <div
            key={m.period}
            className={`rounded-lg border transition-all overflow-hidden ${
              activeMonth ? 'border-accent' : 'border-white/[0.08] bg-white/[0.04]'
            }`}
          >
            <button
              onClick={() => {
                onExpandMonth(expandedMonth === m.period ? null : m.period);
                if (!m.isFull) onSelectPeriod(m.period);
              }}
              className={`relative w-full px-2.5 py-2 text-left cursor-pointer ${monthSelected ? 'bg-accent' : ''}`}
            >
              {monthSelected && (
                <div className="absolute top-1.5 right-1.5">
                  <Check className="w-3.5 h-3.5 text-primary" />
                </div>
              )}
              <div className="flex items-center justify-between gap-1 pr-4">
                <p className={`text-xs font-bold truncate ${monthSelected ? 'text-primary' : 'text-white'}`}>
                  {shortLabel}
                </p>
                <span className={`text-[10px] font-bold flex-shrink-0 ${monthSelected ? 'text-primary/80' : 'text-accent'}`}>
                  ₹{(Number(m.fee) || 0).toLocaleString()}
                </span>
              </div>
              <p className={`text-[10px] mt-0.5 ${monthSelected ? 'text-primary/70' : 'text-slate-400'}`}>
                <Users className="w-3 h-3 inline mr-1 -mt-0.5" />
                {m.enrolled}/{m.capacity} enrolled
                {m.isFull && <span className={`font-semibold ml-1 ${monthSelected ? 'text-primary' : 'text-red-400'}`}>· Full</span>}
              </p>
            </button>

            {/* Half-month options — full / first half / second half */}
            {expandedMonth === m.period && (
              <div className="px-2 pb-2 grid grid-cols-1 gap-1.5">
                {[{ ...m, label: 'Full Month' } as MonthOption]
                  .concat((m.halves ?? []).map((h) => ({
                    ...h,
                    label: h.period.endsWith('H1') ? 'First Half' : 'Second Half',
                  })))
                  .map((opt) => {
                    const active = selectedPeriod === opt.period;
                    return (
                      <button
                        key={opt.period}
                        disabled={opt.isFull}
                        onClick={() => onSelectPeriod(active ? null : opt.period)}
                        className={`px-2.5 py-1.5 rounded-lg border text-left transition-all ${
                          opt.isFull
                            ? 'opacity-50 cursor-not-allowed border-white/[0.06] bg-white/[0.02]'
                            : active
                              ? 'bg-accent text-primary border-accent cursor-pointer'
                              : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:border-accent/30 cursor-pointer'
                        }`}
                      >
                        <span className="block text-[11px] font-semibold">{opt.label}</span>
                        <span className={`block text-[10px] ${active ? 'text-primary/70' : 'text-slate-500'}`}>
                          ₹{opt.fee}{opt.isFull ? ' · Full' : ''}
                        </span>
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface SessionCardItem {
  key: string;
  date: string;
  dayLabel: string;
  startTime: string;
  endTime: string;
  /** Optional session label ("Morning Batch") — match simulation only. */
  title: string | null;
  coach: string | null;
  fee: number;
  booked: number;
  capacity: number;
  isFull: boolean;
  seatNoun: 'seats' | 'slots';
}

/** Shared card grid for regular corporate sessions + match simulation
 *  sessions: date, day, time, occupancy ("12 of 25 seats booked"),
 *  remaining capacity, and fee — multi-selectable. */
function SessionCardGrid({
  items,
  selected,
  onToggle,
}: {
  items: SessionCardItem[];
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {items.map((item) => {
        const isSelected = selected.has(item.key);
        const remaining = Math.max(0, item.capacity - item.booked);
        return (
          <button
            key={item.key}
            disabled={item.isFull}
            onClick={() => onToggle(item.key)}
            className={`relative px-2.5 py-2 rounded-lg border text-left transition-all ${
              item.isFull
                ? 'bg-white/[0.02] border-white/[0.05] cursor-not-allowed opacity-60'
                : isSelected
                  ? 'bg-accent text-primary border-accent shadow-md shadow-accent/20 cursor-pointer'
                  : 'bg-white/[0.04] border-white/[0.08] hover:border-accent/40 active:scale-[0.98] cursor-pointer'
            }`}
          >
            {isSelected && (
              <div className="absolute top-1.5 right-1.5">
                <Check className="w-3.5 h-3.5" />
              </div>
            )}
            <div className="flex items-center justify-between gap-1 pr-4">
              <p className={`text-xs font-bold truncate ${item.isFull ? 'text-slate-500' : isSelected ? '' : 'text-white'}`}>
                {format(parseISO(item.date), 'EEE').toUpperCase()}, {format(parseISO(item.date), 'd MMM')}
              </p>
              <span className={`text-[10px] font-bold flex-shrink-0 ${isSelected ? 'text-primary/80' : 'text-accent'}`}>
                ₹{item.fee}
              </span>
            </div>
            {item.title && (
              <p className={`text-[10px] font-semibold mt-0.5 truncate ${isSelected ? 'text-primary/80' : 'text-accent'}`}>
                {item.title}
              </p>
            )}
            <p className={`text-[10px] mt-0.5 ${isSelected ? 'text-primary/70' : 'text-slate-400'}`}>
              {formatTimeIST(item.startTime)} – {formatTimeIST(item.endTime)}
              {item.coach ? ` · ${item.coach}` : ''}
            </p>
            <p className={`text-[10px] font-medium mt-0.5 ${
              item.isFull
                ? 'text-red-400'
                : isSelected
                  ? 'text-primary/70'
                  : remaining <= 3
                    ? 'text-amber-400'
                    : 'text-green-400'
            }`}>
              {item.isFull
                ? `Full · ${item.booked}/${item.capacity} ${item.seatNoun}`
                : `${item.booked}/${item.capacity} ${item.seatNoun} · ${remaining} left`}
            </p>
          </button>
        );
      })}
    </div>
  );
}
