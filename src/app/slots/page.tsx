'use client';

import { useState, useEffect, useMemo, Suspense, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams, useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Calendar, Loader2, AlertTriangle, UserCircle } from 'lucide-react';
import { PageBackground } from '@/components/ui/PageBackground';
import { MachineSelector } from '@/components/slots/MachineSelector';
import { DateSelector } from '@/components/slots/DateSelector';
import { OptionsPanel } from '@/components/slots/OptionsPanel';
import { SlotGrid } from '@/components/slots/SlotGrid';
import { PackageSelector } from '@/components/slots/PackageSelector';
import { BookingBar } from '@/components/slots/BookingBar';
import { ContactFooter } from '@/components/ContactFooter';

import { PaymentMethodSelector } from '@/components/ui/PaymentMethodSelector';
import { useSlots } from '@/hooks/useSlots';
import { usePackages } from '@/hooks/usePackages';
import { usePricing } from '@/hooks/usePricing';
import { api } from '@/lib/api-client';
import { MACHINE_CARDS, PITCH_TYPE_LABELS, getMachineCard } from '@/lib/client-constants';
import { useRazorpay, usePaymentConfig } from '@/lib/useRazorpay';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import type { MachineId, MachineConfig, AvailableSlot, OperationMode } from '@/lib/schemas';

export default function SlotsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>}>
      <SlotsContent />
    </Suspense>
  );
}

function SlotsContent() {
  // ─── State ─────────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedMachineId, setSelectedMachineId] = useState<MachineId>('GRAVITY');
  const [ballType, setBallType] = useState('LEATHER');
  const [pitchType, setPitchType] = useState('ASTRO');
  const [operationMode, setOperationMode] = useState<OperationMode>('WITH_OPERATOR');
  const [selectedSlots, setSelectedSlots] = useState<AvailableSlot[]>([]);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [machineConfig, setMachineConfig] = useState<MachineConfig | null>(null);
  const [showBookingConfirm, setShowBookingConfirm] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'ONLINE' | 'CASH'>('ONLINE');
  const [useWallet, setUseWallet] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [kitRental, setKitRental] = useState(false);

  const { data: session } = useSession();
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = searchParams.get('userId');
  const userName = searchParams.get('userName');
  const isAdmin = session?.user?.role === 'ADMIN';
  const isSuperAdmin = !!session?.user?.isSuperAdmin;
  const isFreeUser = !!session?.user?.isFreeUser;
  const isBookingForOther = useMemo(() => !!(isAdmin && userId), [isAdmin, userId]);
  // Free booking: superadmin always free, or current user is free user (self-booking)
  const isFreeBooking = isSuperAdmin || (isFreeUser && !isBookingForOther);

  // Payment integration
  const { config: paymentConfig } = usePaymentConfig();
  const { initiatePayment, processing: paymentProcessing } = useRazorpay({
    onFailure: (error) => {
      toast.error(error || 'Payment failed');
    },
  }, paymentConfig?.paymentEnabled ?? false);

  // Kit rental config from payment config API
  const kitRentalCfg = paymentConfig?.kitRentalConfig;
  const KIT_RENTAL_CHARGE = kitRentalCfg?.price ?? 200;
  const isKitRentalEnabled = kitRentalCfg?.enabled ?? false;
  const kitRentalMachines = (kitRentalCfg?.machines ?? ['GRAVITY', 'YANTRA']) as MachineId[];

  // ─── Derived State ─────────────────────────────────────
  const selectedCard = getMachineCard(selectedMachineId);
  const isKitRentalAvailable = isKitRentalEnabled && kitRentalMachines.includes(selectedMachineId);
  const isLeatherMachine = selectedCard.category === 'LEATHER';
  const selectedMachineInfo = machineConfig?.machines?.find(m => m.id === selectedMachineId);
  const enabledPitchTypes = selectedMachineInfo?.enabledPitchTypes || [];
  const showPitchSelection = enabledPitchTypes.length > 1;
  const showPitchIndicator = enabledPitchTypes.length === 1;

  // ─── Refs ──────────────────────────────────────────────
  const hasAutoSelectedMachineRef = useRef(false);

  // ─── Hooks ─────────────────────────────────────────────
  const { slots, loading, error, fetchSlots } = useSlots();
  const pkg = usePackages();
  const isSpecialUser = !!session?.user?.isSpecialUser;
  const pricing = usePricing({
    selectedSlots,
    machineConfig,
    selectedMachineId,
    isLeatherMachine,
    ballType,
    pitchType,
    isSpecialUser,
  });

  // Reset payment method to ONLINE if cash is disabled
  useEffect(() => {
    if (paymentConfig && !paymentConfig.cashPaymentEnabled && paymentMethod === 'CASH') {
      setPaymentMethod('ONLINE');
    }
  }, [paymentConfig, paymentMethod]);

  // ─── Fetch machine config on mount ─────────────────────
  useEffect(() => {
    api.get<MachineConfig>('/api/machine-config')
      .then(setMachineConfig)
      .catch(() => {});
  }, []);

  // ─── Fetch packages when session is ready ──────────────
  useEffect(() => {
    if (session) {
      pkg.fetchPackages(isBookingForOther, userId);
    }
  }, [session, isBookingForOther, userId]);

  // ─── Fetch slots when filters change ───────────────────
  useEffect(() => {
    fetchSlots(selectedDate, selectedMachineId, ballType, pitchType);
    setSelectedSlots([]);
  }, [selectedDate, selectedMachineId, ballType, pitchType, fetchSlots]);

  // ─── Validate package when selection changes ───────────
  useEffect(() => {
    if (pkg.selectedPackageId && selectedSlots.length > 0) {
      pkg.validatePackage({
        userPackageId: pkg.selectedPackageId,
        ballType,
        pitchType: showPitchSelection ? pitchType : null,
        startTime: selectedSlots[0].startTime,
        numberOfSlots: selectedSlots.length,
        userId: isBookingForOther ? userId : undefined,
        machineId: selectedMachineId,
        slotTimes: selectedSlots.map(s => s.startTime),
      });
    } else {
      // Reset validation
      pkg.validatePackage({
        userPackageId: '',
        ballType,
        pitchType: null,
        startTime: '',
        numberOfSlots: 0,
      });
    }
  }, [selectedSlots, pkg.selectedPackageId, selectedMachineId]);

  // ─── Auto-select package if user has one ────────────────
  useEffect(() => {
    if (pkg.userDeclinedPackage) return;
    if (pkg.packages.length === 0 || pkg.selectedPackageId) return;

    // Find first active package with remaining sessions
    const firstActive = pkg.packages.find(
      up => up.status === 'ACTIVE' && up.remainingSessions > 0
    );
    if (firstActive) {
      pkg.setSelectedPackageId(firstActive.id);
    }
  }, [pkg.packages]);

  // ─── Auto-select compatible package ────────────────────
  useEffect(() => {
    // Don't auto-select if user explicitly chose "Don't use package"
    if (pkg.userDeclinedPackage) return;
    if (pkg.packages.length === 0 || selectedSlots.length === 0 || pkg.selectedPackageId) return;

    // Prefer exact machine match (package has specific machineId matching selected machine)
    const exactMatch = pkg.packages.find(up =>
      up.status === 'ACTIVE' && up.remainingSessions >= selectedSlots.length && up.machineId === selectedMachineId
    );

    // Fall back to category match, but only for packages without a specific machineId
    const categoryMatch = !exactMatch ? pkg.packages.find(up => {
      if (up.machineId) return false; // Skip packages tied to a different specific machine
      const machineCompatible =
        (up.machineType === 'LEATHER' && isLeatherMachine) ||
        (up.machineType === 'TENNIS' && !isLeatherMachine);
      return up.status === 'ACTIVE' && up.remainingSessions >= selectedSlots.length && machineCompatible;
    }) : null;

    const compatible = exactMatch || categoryMatch;
    if (compatible) pkg.setSelectedPackageId(compatible.id);
  }, [pkg.packages, selectedSlots, pkg.selectedPackageId, isLeatherMachine, selectedMachineId, pkg.userDeclinedPackage]);

  // ─── Auto-switch to SELF_OPERATE if needed ─────────────
  useEffect(() => {
    if (!isLeatherMachine) {
      const hasNoOp = selectedSlots.some(s => !s.operatorAvailable);
      if (hasNoOp && operationMode === 'WITH_OPERATOR') {
        setOperationMode('SELF_OPERATE');
      }
    }
  }, [selectedSlots, isLeatherMachine, operationMode]);

  // ─── Handlers ──────────────────────────────────────────
  const handleToggleSlot = useCallback((slot: AvailableSlot) => {
    if (slot.status === 'Booked' || slot.status === 'OperatorUnavailable') return;
    setSelectedSlots(prev => {
      const exists = prev.find(s => s.startTime === slot.startTime);
      return exists ? prev.filter(s => s.startTime !== slot.startTime) : [...prev, slot];
    });
  }, []);

  const handleMachineSelect = useCallback((machineId: MachineId) => {
    const card = MACHINE_CARDS.find(m => m.id === machineId)!;
    setSelectedMachineId(machineId);
    setSelectedSlots([]);
    pkg.reset();
    setKitRental(false);

    setBallType(card.category === 'LEATHER' ? 'LEATHER' : 'TENNIS');
    setOperationMode('WITH_OPERATOR');

    const info = machineConfig?.machines?.find(m => m.id === machineId);
    setPitchType(info?.enabledPitchTypes?.[0] || 'ASTRO');
  }, [machineConfig, pkg]);

  // ─── Auto-select machine based on user's package ───────
  useEffect(() => {
    if (hasAutoSelectedMachineRef.current || pkg.packages.length === 0) return;

    // Find first active package with a specific machineId
    const packageWithMachine = pkg.packages.find(
      up => up.status === 'ACTIVE' && up.remainingSessions > 0 && up.machineId
    );

    if (packageWithMachine?.machineId) {
      const machineId = packageWithMachine.machineId as MachineId;
      if (machineId !== selectedMachineId) {
        handleMachineSelect(machineId);
      }
    }
    hasAutoSelectedMachineRef.current = true;
  }, [pkg.packages, handleMachineSelect, selectedMachineId]);

  const getSlotOperationMode = (slot: AvailableSlot): OperationMode => {
    if (isLeatherMachine) return 'WITH_OPERATOR';
    if (!slot.operatorAvailable) return 'SELF_OPERATE';
    return operationMode;
  };

  const hasSelectedSlotsWithoutOperator = !isLeatherMachine && selectedSlots.some(s => !s.operatorAvailable);

  // Kit rental total for all selected slots
  const kitRentalTotal = kitRental && isKitRentalAvailable ? KIT_RENTAL_CHARGE * selectedSlots.length : 0;

  // Build booking details for confirm dialog
  const getBookingConfirmDetails = () => {
    const baseTotal = pkg.selectedPackageId && pkg.validation ? (pkg.validation.extraCharge || 0) : pricing.totalPrice;
    const total = baseTotal + kitRentalTotal;
    const walletDeduction = useWallet && walletBalance > 0 ? Math.min(walletBalance, total) : 0;
    const amountAfterWallet = total - walletDeduction;
    const selfOperateSlots = !isLeatherMachine
      ? selectedSlots.filter(s => getSlotOperationMode(s) === 'SELF_OPERATE').length
      : 0;
    const isPackageBooking = !!pkg.selectedPackageId;

    const isCashPayment = paymentMethod === 'CASH';

    let message = '';
    if (isFreeBooking) {
      message = `Book ${selectedSlots.length} slot(s) for FREE?${isBookingForOther ? ` For: ${userName}` : ''}`;
    } else if (isBookingForOther) {
      message = `Book ${selectedSlots.length} slot(s) for ${userName}?`;
    } else if (isPackageBooking && total === 0) {
      message = `Book ${selectedSlots.length} slot(s) using package?`;
    } else if (walletDeduction > 0 && amountAfterWallet > 0) {
      message = `Book ${selectedSlots.length} slot(s)? ₹${walletDeduction} from wallet + ₹${amountAfterWallet.toLocaleString()} ${isCashPayment ? 'at center' : 'online'}.`;
    } else if (walletDeduction > 0 && amountAfterWallet === 0) {
      message = `Book ${selectedSlots.length} slot(s)? ₹${walletDeduction} will be deducted from wallet.`;
    } else if (isPackageBooking) {
      message = `Book ${selectedSlots.length} slot(s) using package? Extra charge: ₹${total}`;
    } else if (isCashPayment) {
      message = `Book ${selectedSlots.length} slot(s)? Pay ₹${total.toLocaleString()} at center.`;
    } else {
      message = `Book ${selectedSlots.length} slot(s) for ₹${total.toLocaleString()}?`;
    }

    let warning = '';
    if (selfOperateSlots > 0) {
      warning = `${selfOperateSlots} slot(s) will be Self Operate — no machine operator provided. You must operate the machine yourself.`;
    }

    const requiresOnlinePayment = paymentConfig?.paymentEnabled
      && paymentConfig?.slotPaymentRequired
      && (!isPackageBooking || (isPackageBooking && total > 0))
      && !isBookingForOther
      && !isFreeBooking
      && !isCashPayment
      && amountAfterWallet > 0;

    const confirmLabel = requiresOnlinePayment
      ? (isPackageBooking ? `Pay Extra ₹${amountAfterWallet.toLocaleString()}` : `Pay ₹${amountAfterWallet.toLocaleString()}`)
      : walletDeduction > 0 && amountAfterWallet === 0
        ? 'Confirm (Wallet)'
        : 'Confirm Booking';

    return { message, warning, confirmLabel };
  };

  const handleBook = async () => {
    if (selectedSlots.length === 0) return;
    if (pkg.selectedPackageId && pkg.validation && !pkg.validation.valid) {
      toast.error(pkg.validation.error || 'Selected package is not valid for this booking');
      return;
    }

    // Show confirm dialog instead of window.confirm
    setShowBookingConfirm(true);
  };

  const handleBookConfirm = async () => {
    setShowBookingConfirm(false);

    const baseTotal = pkg.selectedPackageId && pkg.validation ? (pkg.validation.extraCharge || 0) : pricing.totalPrice;
    const total = baseTotal + kitRentalTotal;
    const walletDeduction = useWallet && walletBalance > 0 ? Math.min(walletBalance, total) : 0;
    const amountAfterWallet = total - walletDeduction;

    const isPackageBooking = !!pkg.selectedPackageId;
    const isCashPayment = paymentMethod === 'CASH';
    const walletCoversAll = walletDeduction > 0 && amountAfterWallet === 0;
    const requiresOnlinePayment = paymentConfig?.paymentEnabled
      && paymentConfig?.slotPaymentRequired
      && (!isPackageBooking || (isPackageBooking && total > 0))
      && !isBookingForOther
      && !isFreeBooking
      && !isCashPayment
      && !walletCoversAll
      && amountAfterWallet > 0;

    const bookingPayload = selectedSlots.map(slot => ({
      date: format(selectedDate, 'yyyy-MM-dd'),
      startTime: slot.startTime,
      endTime: slot.endTime,
      ballType,
      machineId: selectedMachineId,
      operationMode: getSlotOperationMode(slot),
      userPackageId: pkg.selectedPackageId || undefined,
      userId: isBookingForOther ? userId : undefined,
      playerName: isBookingForOther ? userName : undefined,
      ...(pitchType ? { pitchType } : {}),
      ...(isCashPayment ? { paymentMethod: 'CASH' as const } : walletCoversAll ? { paymentMethod: 'WALLET' as const } : {}),
      ...(walletDeduction > 0 ? { walletDeduction } : {}),
      ...(kitRental && isKitRentalAvailable ? { kitRental: true, kitRentalCharge: KIT_RENTAL_CHARGE } : {}),
    }));

    // If online payment is required, go through Razorpay first
    if (requiresOnlinePayment) {
      setBookingLoading(true);
      try {
        // Send the full booking payload with the payment so the server can create
        // bookings atomically in the verify route — no second client call needed.
        const paymentResult = await initiatePayment({
          type: 'SLOT_BOOKING',
          amount: amountAfterWallet,
          slots: selectedSlots.map(s => ({
            date: format(selectedDate, 'yyyy-MM-dd'),
            startTime: s.startTime,
            endTime: s.endTime,
          })),
          bookingPayload,
          description: `${selectedSlots.length} slot(s) - ${selectedCard.label} - ${format(selectedDate, 'MMM d')}`,
          prefill: {
            name: session?.user?.name || undefined,
            email: session?.user?.email || undefined,
          },
        });

        if (!paymentResult) {
          // User cancelled or payment failed (error already shown by hook)
          setBookingLoading(false);
          return;
        }

        // Bookings are now created atomically by the verify route.
        // Belt-and-suspenders: if verify returned bookings, link them (server already does this).
        if (paymentResult.bookings && paymentResult.bookings.length > 0) {
          const bookingIds = paymentResult.bookings.map(b => b.id);
          await fetch('/api/payments/link-bookings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              paymentId: paymentResult.paymentId,
              bookingIds,
            }),
          }).catch(() => {}); // Non-critical — server already linked them
        }

        toast.success('Payment successful! Booking confirmed.');
        setSelectedSlots([]);
        pkg.reset();
        router.push('/bookings');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Booking failed after payment. Please contact admin.');
      } finally {
        setBookingLoading(false);
      }
      return;
    }

    // No online payment required — direct booking (free, admin, cash, or package flow)
    setBookingLoading(true);
    try {
      await api.post('/api/slots/book', bookingPayload);

      toast.success(
        isCashPayment
          ? walletDeduction > 0
            ? `Booking confirmed! ₹${walletDeduction} from wallet. Pay ₹${amountAfterWallet} at center.`
            : 'Booking confirmed! Pay at center when you arrive.'
          : walletCoversAll
            ? 'Booking confirmed! Payment deducted from wallet.'
            : 'Booking confirmed! Check My Bookings for details.'
      );
      setSelectedSlots([]);
      pkg.reset();
      router.push('/bookings');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Booking failed. Please try again.');
    } finally {
      setBookingLoading(false);
    }
  };

  // ─── Machine label for booking bar ─────────────────────
  const getMachineLabel = (): string => {
    let label = selectedCard.label;
    if (isLeatherMachine && machineConfig?.leatherMachine.ballTypeSelectionEnabled) {
      label += ` (${ballType === 'LEATHER' ? 'Leather' : 'Machine'})`;
    }
    if (showPitchSelection) {
      const pt = PITCH_TYPE_LABELS[pitchType];
      label += ` - ${pt?.label || pitchType}`;
    }
    return label;
  };

  // ─── Render ────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 py-5 pb-40 md:pb-28">
      <PageBackground />

      {/* Admin Mode Banner */}
      {isBookingForOther && (
        <div className="mb-6 px-4 py-3 bg-accent/10 border border-accent/20 rounded-xl flex items-center gap-3">
          <UserCircle className="w-5 h-5 text-accent" />
          <div>
            <p className="text-[10px] font-bold text-accent uppercase tracking-wider">Admin Mode</p>
            <p className="text-sm font-medium text-white">Booking for: <span className="text-accent">{userName}</span></p>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
          <Calendar className="w-4 h-4 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">Book Your Slot</h1>
          <p className="text-[11px] text-slate-400">Select date, machine & time</p>
        </div>
      </div>

      <MachineSelector
        selectedMachineId={selectedMachineId}
        onSelect={handleMachineSelect}
      />

      <hr className="border-white/[0.06] my-4" />

      <OptionsPanel
        isLeatherMachine={isLeatherMachine}
        machineConfig={machineConfig}
        ballType={ballType}
        pitchType={pitchType}
        operationMode={operationMode}
        enabledPitchTypes={enabledPitchTypes}
        showPitchSelection={showPitchSelection}
        showPitchIndicator={showPitchIndicator}
        onBallTypeChange={(v) => { setBallType(v); setSelectedSlots([]); }}
        onPitchTypeChange={(v) => { setPitchType(v); setSelectedSlots([]); }}
        onOperationModeChange={(m) => { setOperationMode(m); setSelectedSlots([]); }}
      />

      {/* Package Selection - before date */}
      {session && (
        <PackageSelector
          packages={pkg.packages}
          selectedPackageId={pkg.selectedPackageId}
          onSelect={pkg.setSelectedPackageId}
          validation={pkg.validation}
          isValidating={pkg.isValidating}
        />
      )}

      <DateSelector selectedDate={selectedDate} onSelect={setSelectedDate} />

      <hr className="border-white/[0.06] my-4" />

      <SlotGrid
        slots={slots}
        selectedSlots={selectedSlots}
        loading={loading}
        error={error}
        isLeatherMachine={isLeatherMachine}
        bookingLoading={bookingLoading}
        selectedPackageId={pkg.selectedPackageId}
        packageValidation={pkg.validation}
        onToggleSlot={handleToggleSlot}
        onRetry={() => fetchSlots(selectedDate, selectedMachineId, ballType, pitchType)}
        getSlotDisplayPrice={pricing.getSlotDisplayPrice}
      />

      {/* Operator warnings */}
      {!isLeatherMachine && hasSelectedSlotsWithoutOperator && (
        <div className="mt-4 px-3 py-3 bg-red-500/15 border-2 border-red-500/40 rounded-lg flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-red-400">Self Operate Warning</p>
            <p className="text-xs text-red-300 mt-0.5">
              Machine operator not available for some selected slots. Those slots will be booked as Self Operate &mdash; you must operate the machine yourself.
            </p>
          </div>
        </div>
      )}

      {isLeatherMachine && slots.some(s => s.status === 'OperatorUnavailable') && (
        <div className="mt-4 px-3 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-400">
            Some slots show &ldquo;Not Available&rdquo; because the machine operator is busy with another machine at that time.
            Leather machine always requires a machine operator.
          </p>
        </div>
      )}

      <hr className="border-white/[0.06] my-4" />

      {/* Kit Rental Option - Configurable from admin */}
      {isKitRentalAvailable && selectedSlots.length > 0 && (
        <div className="mb-4">
          <label className="flex items-start gap-3 p-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl cursor-pointer hover:bg-white/[0.06] transition-colors">
            <input
              type="checkbox"
              checked={kitRental}
              onChange={e => setKitRental(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-accent rounded"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">{kitRentalCfg?.title || 'Cricket Kit & Bat Rental'}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {kitRentalCfg?.description || 'Rent cricket kit and bat for your session'} at <span className="text-accent font-semibold">&#8377;{KIT_RENTAL_CHARGE}/session</span>
              </p>
              {kitRentalCfg?.note && (
                <p className="text-[10px] text-amber-400/80 mt-1">
                  Note: {kitRentalCfg.note}
                </p>
              )}
              {kitRental && selectedSlots.length > 0 && (
                <p className="text-[11px] text-accent font-medium mt-1">
                  +&#8377;{kitRentalTotal} ({selectedSlots.length} session{selectedSlots.length > 1 ? 's' : ''})
                </p>
              )}
            </div>
          </label>
        </div>
      )}

      {/* Payment Method Selection */}
      {selectedSlots.length > 0
        && paymentConfig?.paymentEnabled
        && paymentConfig?.slotPaymentRequired
        && (paymentConfig?.cashPaymentEnabled || paymentConfig?.walletEnabled)
        && !isBookingForOther
        && !isFreeBooking
        && (
        <div className="mb-4">
          <p className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Payment</p>
          <PaymentMethodSelector
            selected={paymentMethod}
            onChange={setPaymentMethod}
            disabled={bookingLoading || paymentProcessing}
            showCash={paymentConfig?.cashPaymentEnabled}
            showWallet={paymentConfig?.walletEnabled}
            totalAmount={(pkg.selectedPackageId && pkg.validation ? (pkg.validation.extraCharge || 0) : pricing.totalPrice) + kitRentalTotal}
            useWallet={useWallet}
            onUseWalletChange={setUseWallet}
            onWalletBalanceLoaded={setWalletBalance}
          />
        </div>
      )}

      <ContactFooter />

      {/* Booking Confirm Dialog */}
      {(() => {
        const details = getBookingConfirmDetails();
        return (
          <ConfirmDialog
            open={showBookingConfirm}
            title="Confirm Booking"
            message={details.message}
            warning={details.warning || undefined}
            confirmLabel={details.confirmLabel}
            cancelLabel="Go Back"
            loading={bookingLoading || paymentProcessing}
            onConfirm={handleBookConfirm}
            onCancel={() => setShowBookingConfirm(false)}
          />
        );
      })()}

      <BookingBar
        selectedSlots={selectedSlots}
        selectedDate={selectedDate}
        machineLabel={getMachineLabel()}
        isLeatherMachine={isLeatherMachine}
        operationMode={operationMode}
        hasSelectedSlotsWithoutOperator={hasSelectedSlotsWithoutOperator}
        totalPrice={pricing.totalPrice}
        originalTotal={pricing.originalTotal}
        hasSavings={pricing.hasSavings}
        recurringDiscount={pricing.recurringDiscount}
        promoDiscount={pricing.promoDiscount}
        promoLabel={pricing.promoLabel}
        selectedPackageId={pkg.selectedPackageId}
        packageValidation={pkg.validation}
        bookingLoading={bookingLoading || paymentProcessing}
        isSuperAdmin={!!isFreeBooking}
        kitRentalTotal={kitRentalTotal}
        onBook={handleBook}
      />
    </div>
  );
}
