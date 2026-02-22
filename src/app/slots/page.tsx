'use client';

import { useState, useEffect, useMemo, Suspense, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
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
import { useSlots } from '@/hooks/useSlots';
import { usePackages } from '@/hooks/usePackages';
import { usePricing } from '@/hooks/usePricing';
import { api } from '@/lib/api-client';
import { MACHINE_CARDS, PITCH_TYPE_LABELS, getMachineCard } from '@/lib/client-constants';
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

  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const userId = searchParams.get('userId');
  const userName = searchParams.get('userName');
  const isAdmin = session?.user?.role === 'ADMIN';
  const isBookingForOther = useMemo(() => !!(isAdmin && userId), [isAdmin, userId]);

  // ─── Derived State ─────────────────────────────────────
  const selectedCard = getMachineCard(selectedMachineId);
  const isLeatherMachine = selectedCard.category === 'LEATHER';
  const selectedMachineInfo = machineConfig?.machines?.find(m => m.id === selectedMachineId);
  const enabledPitchTypes = selectedMachineInfo?.enabledPitchTypes || [];
  const showPitchSelection = enabledPitchTypes.length > 1;
  const showPitchIndicator = enabledPitchTypes.length === 1;

  // ─── Hooks ─────────────────────────────────────────────
  const { slots, loading, error, fetchSlots } = useSlots();
  const pkg = usePackages();
  const pricing = usePricing({
    selectedSlots,
    machineConfig,
    selectedMachineId,
    isLeatherMachine,
    ballType,
    pitchType,
  });

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
  }, [selectedSlots, pkg.selectedPackageId]);

  // ─── Auto-select compatible package ────────────────────
  useEffect(() => {
    if (pkg.packages.length > 0 && selectedSlots.length > 0 && !pkg.selectedPackageId) {
      const compatible = pkg.packages.find(up => {
        const machineCompatible =
          (up.machineType === 'LEATHER' && isLeatherMachine) ||
          (up.machineType === 'TENNIS' && !isLeatherMachine);
        return up.status === 'ACTIVE' && up.remainingSessions >= selectedSlots.length && machineCompatible;
      });
      if (compatible) pkg.setSelectedPackageId(compatible.id);
    }
  }, [pkg.packages, selectedSlots, pkg.selectedPackageId, isLeatherMachine]);

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

    setBallType(card.category === 'LEATHER' ? 'LEATHER' : 'TENNIS');
    setOperationMode('WITH_OPERATOR');

    const info = machineConfig?.machines?.find(m => m.id === machineId);
    setPitchType(info?.enabledPitchTypes?.[0] || 'ASTRO');
  }, [machineConfig, pkg]);

  const getSlotOperationMode = (slot: AvailableSlot): OperationMode => {
    if (isLeatherMachine) return 'WITH_OPERATOR';
    if (!slot.operatorAvailable) return 'SELF_OPERATE';
    return operationMode;
  };

  const hasSelectedSlotsWithoutOperator = !isLeatherMachine && selectedSlots.some(s => !s.operatorAvailable);

  const handleBook = async () => {
    if (selectedSlots.length === 0) return;
    if (pkg.selectedPackageId && pkg.validation && !pkg.validation.valid) {
      alert(pkg.validation.error || 'Selected package is not valid for this booking');
      return;
    }

    const total = pkg.selectedPackageId && pkg.validation ? (pkg.validation.extraCharge || 0) : pricing.totalPrice;
    const selfOperateSlots = !isLeatherMachine
      ? selectedSlots.filter(s => getSlotOperationMode(s) === 'SELF_OPERATE').length
      : 0;

    let confirmMessage = isBookingForOther
      ? `Book ${selectedSlots.length} slot(s) for ${userName}?`
      : pkg.selectedPackageId
        ? `Book ${selectedSlots.length} slot(s) using package? ${total > 0 ? `Extra charge: ₹${total}` : ''}`
        : `Book ${selectedSlots.length} slot(s) for ₹${total.toLocaleString()}?`;

    if (selfOperateSlots > 0) {
      confirmMessage += `\n\n⚠️ WARNING: ${selfOperateSlots} slot(s) will be Self Operate (no machine operator provided). You must operate the machine yourself.`;
    }

    if (!window.confirm(confirmMessage)) return;

    setBookingLoading(true);
    try {
      await api.post('/api/slots/book', selectedSlots.map(slot => ({
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
      })));

      alert('Booking successful!');
      setSelectedSlots([]);
      pkg.reset();
      fetchSlots(selectedDate, selectedMachineId, ballType, pitchType);
      pkg.fetchPackages(isBookingForOther, userId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Booking failed');
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
    <div className="max-w-2xl mx-auto px-4 py-5 pb-28">
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
          <h1 className="text-lg font-bold text-white">Book a Slot</h1>
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
            Some slots show &ldquo;No Machine Operator&rdquo; because the machine operator is busy with another machine at that time.
            Leather machine always requires a machine operator.
          </p>
        </div>
      )}

      <hr className="border-white/[0.06] my-4" />

      {/* Package Selection */}
      {session && (
        <PackageSelector
          packages={pkg.packages}
          selectedPackageId={pkg.selectedPackageId}
          onSelect={pkg.setSelectedPackageId}
          validation={pkg.validation}
          isValidating={pkg.isValidating}
        />
      )}

      <ContactFooter />

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
        selectedPackageId={pkg.selectedPackageId}
        packageValidation={pkg.validation}
        bookingLoading={bookingLoading}
        onBook={handleBook}
      />
    </div>
  );
}
