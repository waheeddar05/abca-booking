'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { format, addDays, parseISO, isBefore, startOfDay } from 'date-fns';
import { Calendar, Check, Loader2, IndianRupee, AlertTriangle, Phone, Package, ChevronDown, UserCircle } from 'lucide-react';
import type { PricingConfig, TimeSlabConfig } from '@/lib/pricing';

type MachineId = 'GRAVITY' | 'YANTRA' | 'LEVERAGE_INDOOR' | 'LEVERAGE_OUTDOOR';

interface MachineInfo {
  id: MachineId;
  name: string;
  shortName: string;
  ballType: string;
  category: 'LEATHER' | 'TENNIS';
  enabledPitchTypes: string[];
}

interface MachineConfig {
  machines?: MachineInfo[];
  leatherMachine: {
    ballTypeSelectionEnabled: boolean;
    leatherBallExtraCharge: number;
    machineBallExtraCharge: number;
    pitchTypeSelectionEnabled: boolean;
  };
  tennisMachine: {
    pitchTypeSelectionEnabled: boolean;
    astroPitchPrice: number;
    turfPitchPrice: number;
  };
  defaultSlotPrice: number;
  numberOfOperators: number;
  pricingConfig: PricingConfig;
  timeSlabConfig: TimeSlabConfig;
}

const MACHINE_CARDS: Array<{
  id: MachineId;
  label: string;
  shortLabel: string;
  category: 'LEATHER' | 'TENNIS';
  image: string;
  dotColor: string;
  activeRing: string;
  activeBg: string;
}> = [
  {
    id: 'GRAVITY',
    label: 'Gravity',
    shortLabel: 'Leather',
    category: 'LEATHER',
    image: '/images/leathermachine.jpeg',
    dotColor: 'bg-red-500',
    activeRing: 'ring-red-500/50',
    activeBg: 'bg-red-500/10',
  },
  {
    id: 'YANTRA',
    label: 'Yantra',
    shortLabel: 'Premium Leather',
    category: 'LEATHER',
    image: '/images/yantra-machine.jpeg',
    dotColor: 'bg-amber-500',
    activeRing: 'ring-amber-500/50',
    activeBg: 'bg-amber-500/10',
  },
  {
    id: 'LEVERAGE_INDOOR',
    label: 'Leverage Indoor',
    shortLabel: 'High Speed Tennis',
    category: 'TENNIS',
    image: '/images/tennismachine.jpeg',
    dotColor: 'bg-green-500',
    activeRing: 'ring-green-500/50',
    activeBg: 'bg-green-500/10',
  },
  {
    id: 'LEVERAGE_OUTDOOR',
    label: 'Leverage Outdoor',
    shortLabel: 'High Speed Tennis',
    category: 'TENNIS',
    image: '/images/tennismachine.jpeg',
    dotColor: 'bg-teal-500',
    activeRing: 'ring-teal-500/50',
    activeBg: 'bg-teal-500/10',
  },
];

const PITCH_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  ASTRO: { label: 'Astro Turf', color: 'bg-emerald-500' },
  CEMENT: { label: 'Cement', color: 'bg-amber-500' },
  NATURAL: { label: 'Natural Turf', color: 'bg-lime-500' },
  TURF: { label: 'Cement Wicket', color: 'bg-amber-500' },
};

const BALL_TYPES = [
  { value: 'LEATHER', label: 'Leather Ball', color: 'bg-red-500' },
  { value: 'MACHINE', label: 'Machine Ball', color: 'bg-green-500' },
  { value: 'TENNIS', label: 'Tennis Ball', color: 'bg-yellow-500' },
];

export default function SlotsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>}>
      <SlotsContent />
    </Suspense>
  );
}

function SlotsContent() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedMachineId, setSelectedMachineId] = useState<MachineId>('GRAVITY');
  const [ballType, setBallType] = useState('LEATHER');
  const [pitchType, setPitchType] = useState<string>('ASTRO');
  const [operationMode, setOperationMode] = useState<'WITH_OPERATOR' | 'SELF_OPERATE'>('WITH_OPERATOR');
  const [slots, setSlots] = useState<any[]>([]);
  const [selectedSlots, setSelectedSlots] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bookingLoading, setBookingLoading] = useState(false);
  const [machineConfig, setMachineConfig] = useState<MachineConfig | null>(null);
  const [userPackages, setUserPackages] = useState<any[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string>('');
  const [packageValidation, setPackageValidation] = useState<any>(null);
  const [isValidatingPackage, setIsValidatingPackage] = useState(false);

  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const userId = searchParams.get('userId');
  const userName = searchParams.get('userName');
  const isAdmin = session?.user?.role === 'ADMIN';

  const isBookingForOther = useMemo(() => isAdmin && userId, [isAdmin, userId]);

  // Derive category from selected machine
  const selectedCard = MACHINE_CARDS.find(m => m.id === selectedMachineId)!;
  const category = selectedCard.category === 'LEATHER' ? 'MACHINE' : 'TENNIS';
  const isLeatherMachine = selectedCard.category === 'LEATHER';

  // Get enabled pitch types from machine config API response
  const selectedMachineInfo = machineConfig?.machines?.find(m => m.id === selectedMachineId);
  const enabledPitchTypes = selectedMachineInfo?.enabledPitchTypes || [];
  const showPitchSelection = enabledPitchTypes.length > 1;
  const showPitchIndicator = enabledPitchTypes.length === 1;

  useEffect(() => {
    fetch('/api/machine-config')
      .then(r => r.json())
      .then(setMachineConfig)
      .catch(() => {});

    if (session) {
      const packagesUrl = isBookingForOther
        ? `/api/admin/packages/user-packages?userId=${userId}&status=ACTIVE`
        : '/api/packages/my';

      fetch(packagesUrl)
        .then(r => r.json())
        .then(data => {
          const packages = Array.isArray(data) ? data : [];
          if (isBookingForOther) {
            setUserPackages(packages.map((up: any) => ({
              id: up.id,
              packageName: up.package?.name || up.packageName,
              machineType: up.package?.machineType || up.machineType,
              ballType: up.package?.ballType || up.ballType,
              wicketType: up.package?.wicketType || up.wicketType,
              timingType: up.package?.timingType || up.timingType,
              totalSessions: up.totalSessions,
              usedSessions: up.usedSessions,
              remainingSessions: up.totalSessions - up.usedSessions,
              activationDate: up.activationDate,
              expiryDate: up.expiryDate,
              status: up.status,
              amountPaid: up.amountPaid,
            })));
          } else {
            setUserPackages(packages);
          }
        })
        .catch(() => {});
    }
  }, [session, isBookingForOther, userId]);

  useEffect(() => {
    fetchSlots();
    setSelectedSlots([]);
  }, [selectedDate, selectedMachineId, ballType, pitchType]);

  useEffect(() => {
    validateSelectedPackage();
  }, [selectedSlots, selectedPackageId]);

  useEffect(() => {
    if (userPackages.length > 0 && selectedSlots.length > 0 && !selectedPackageId) {
      const compatiblePackage = userPackages.find(up => {
        const pkgMachineType = up.machineType;
        const machineCompatible = (pkgMachineType === 'LEATHER' && isLeatherMachine) ||
                                (pkgMachineType === 'TENNIS' && !isLeatherMachine);

        return up.status === 'ACTIVE' &&
               up.remainingSessions >= selectedSlots.length &&
               machineCompatible;
      });

      if (compatiblePackage) {
        setSelectedPackageId(compatiblePackage.id);
      }
    }
  }, [userPackages, selectedSlots, selectedPackageId, isLeatherMachine]);

  const validateSelectedPackage = async () => {
    if (!selectedPackageId || selectedSlots.length === 0) {
      setPackageValidation(null);
      return;
    }

    setIsValidatingPackage(true);
    try {
      const firstSlot = selectedSlots[0];
      const res = await fetch('/api/packages/validate-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPackageId: selectedPackageId,
          ballType,
          pitchType: showPitchSelection ? pitchType : null,
          startTime: firstSlot.startTime,
          numberOfSlots: selectedSlots.length,
          ...(isBookingForOther ? { userId } : {}),
        }),
      });
      const data = await res.json();
      setPackageValidation(data);
    } catch (e) {
      console.error('Package validation failed', e);
    } finally {
      setIsValidatingPackage(false);
    }
  };

  useEffect(() => {
    if (!isLeatherMachine) {
      const hasNoOperatorSlots = selectedSlots.some(s => !s.operatorAvailable);
      if (hasNoOperatorSlots && operationMode === 'WITH_OPERATOR') {
        setOperationMode('SELF_OPERATE');
      }
    }
  }, [selectedSlots, isLeatherMachine]);

  const fetchSlots = async () => {
    setLoading(true);
    setError('');
    try {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      let url = `/api/slots/available?date=${dateStr}&machineId=${selectedMachineId}&ballType=${ballType}`;
      if (pitchType) {
        url += `&pitchType=${pitchType}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch slots');
      const data = await res.json();
      setSlots(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSlot = (slot: any) => {
    if (slot.status === 'Booked' || slot.status === 'OperatorUnavailable') return;

    setSelectedSlots(prev => {
      const isSelected = prev.find(s => s.startTime === slot.startTime);
      if (isSelected) {
        return prev.filter(s => s.startTime !== slot.startTime);
      } else {
        return [...prev, slot];
      }
    });
  };

  const getSlotDisplayPrice = (slot: any): number => {
    return slot.price ?? machineConfig?.defaultSlotPrice ?? 600;
  };

  const isConsecutiveSelection = (): boolean => {
    if (selectedSlots.length < 2) return false;
    const sorted = [...selectedSlots].sort((a, b) =>
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      if (new Date(sorted[i].endTime).getTime() !== new Date(sorted[i + 1].startTime).getTime()) {
        return false;
      }
    }
    return true;
  };

  const getConsecutiveTotal = (): number | null => {
    if (!machineConfig?.pricingConfig || !machineConfig?.timeSlabConfig) return null;
    if (!isConsecutiveSelection()) return null;

    const pc = machineConfig.pricingConfig;
    const sorted = [...selectedSlots].sort((a, b) =>
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

    let totalConsecutivePrice = 0;
    for (const slot of sorted) {
      const slab = (slot.timeSlab as 'morning' | 'evening') || 'morning';

      let consecutivePriceFor2: number;
      const pType = pitchType === 'TURF' ? 'CEMENT' : (pitchType || 'ASTRO');
      const validPType = (pType === 'ASTRO' || pType === 'CEMENT' || pType === 'NATURAL') ? pType : 'ASTRO';

      if (isLeatherMachine) {
        // Yantra has its own pricing tier
        const subType = selectedMachineId === 'YANTRA' ? 'yantra' : (ballType === 'LEATHER' ? 'leather' : 'machine');
        consecutivePriceFor2 = pc[subType as keyof typeof pc][validPType as 'ASTRO' | 'CEMENT' | 'NATURAL'][slab].consecutive;
      } else {
        consecutivePriceFor2 = pc.tennis[validPType as 'ASTRO' | 'CEMENT' | 'NATURAL'][slab].consecutive;
      }

      const perSlotConsecutive = consecutivePriceFor2 / 2;
      totalConsecutivePrice += perSlotConsecutive;
    }

    return totalConsecutivePrice;
  };

  const getTotalPrice = (): number => {
    const consecutiveTotal = getConsecutiveTotal();
    if (consecutiveTotal !== null) return consecutiveTotal;
    return selectedSlots.reduce((sum, slot) => sum + getSlotDisplayPrice(slot), 0);
  };

  const getOriginalTotal = (): number => {
    return selectedSlots.reduce((sum, slot) => sum + getSlotDisplayPrice(slot), 0);
  };

  const hasSelectedSlotsWithoutOperator = !isLeatherMachine &&
    selectedSlots.some(s => !s.operatorAvailable);

  const getSlotOperationMode = (slot: any): 'WITH_OPERATOR' | 'SELF_OPERATE' => {
    if (isLeatherMachine) return 'WITH_OPERATOR';
    if (!slot.operatorAvailable) return 'SELF_OPERATE';
    return operationMode;
  };

  const handleBook = async () => {
    if (selectedSlots.length === 0) return;

    if (selectedPackageId && packageValidation && !packageValidation.valid) {
      alert(packageValidation.error || 'Selected package is not valid for this booking');
      return;
    }

    const total = selectedPackageId && packageValidation ? (packageValidation.extraCharge || 0) : getTotalPrice();
    const selfOperateSlots = !isLeatherMachine
      ? selectedSlots.filter(s => getSlotOperationMode(s) === 'SELF_OPERATE').length
      : 0;

    let confirmMessage = isBookingForOther
      ? `Book ${selectedSlots.length} slot(s) for ${userName}?`
      : (selectedPackageId
          ? `Book ${selectedSlots.length} slot(s) using package? ${total > 0 ? `Extra charge: ₹${total}` : ''}`
          : `Book ${selectedSlots.length} slot(s) for ₹${total.toLocaleString()}?`);

    if (selfOperateSlots > 0) {
      confirmMessage += `\n\n⚠️ WARNING: ${selfOperateSlots} slot(s) will be Self Operate (no machine operator provided). You must operate the machine yourself.`;
    }

    const confirmBooking = window.confirm(confirmMessage);
    if (!confirmBooking) return;

    setBookingLoading(true);
    try {
      const res = await fetch('/api/slots/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedSlots.map(slot => ({
          date: format(selectedDate, 'yyyy-MM-dd'),
          startTime: slot.startTime,
          endTime: slot.endTime,
          ballType: ballType,
          machineId: selectedMachineId,
          operationMode: getSlotOperationMode(slot),
          userPackageId: selectedPackageId || undefined,
          userId: isBookingForOther ? userId : undefined,
          playerName: isBookingForOther ? userName : undefined,
          ...(pitchType ? { pitchType } : {}),
        }))),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Booking failed');
      }

      alert('Booking successful!');
      setSelectedSlots([]);
      setSelectedPackageId('');
      fetchSlots();

      // Refresh packages
      const packagesUrl = isBookingForOther
        ? `/api/admin/packages/user-packages?userId=${userId}&status=ACTIVE`
        : '/api/packages/my';
      fetch(packagesUrl)
        .then(r => r.json())
        .then(data => {
          const packages = Array.isArray(data) ? data : [];
          if (isBookingForOther) {
            setUserPackages(packages.map((up: any) => ({
              id: up.id,
              packageName: up.package?.name || up.packageName,
              machineType: up.package?.machineType || up.machineType,
              ballType: up.package?.ballType || up.ballType,
              wicketType: up.package?.wicketType || up.wicketType,
              timingType: up.package?.timingType || up.timingType,
              totalSessions: up.totalSessions,
              usedSessions: up.usedSessions,
              remainingSessions: up.totalSessions - up.usedSessions,
              activationDate: up.activationDate,
              expiryDate: up.expiryDate,
              status: up.status,
              amountPaid: up.amountPaid,
            })));
          } else {
            setUserPackages(packages);
          }
        })
        .catch(() => {});
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBookingLoading(false);
    }
  };


  const handleMachineSelect = (machineId: MachineId) => {
    const card = MACHINE_CARDS.find(m => m.id === machineId)!;
    setSelectedMachineId(machineId);
    setSelectedSlots([]);
    setSelectedPackageId('');

    if (card.category === 'LEATHER') {
      setBallType('LEATHER');
      setOperationMode('WITH_OPERATOR');
    } else {
      setBallType('TENNIS');
      setOperationMode('WITH_OPERATOR');
    }

    // Set default pitch type from machine config
    const info = machineConfig?.machines?.find(m => m.id === machineId);
    if (info && info.enabledPitchTypes.length > 0) {
      setPitchType(info.enabledPitchTypes[0]);
    } else {
      setPitchType('ASTRO');
    }
  };

  const consecutiveTotal = getConsecutiveTotal();
  const originalTotal = getOriginalTotal();
  const hasSavings = consecutiveTotal !== null && consecutiveTotal < originalTotal;

  // Machine label for bottom bar
  const getMachineLabel = () => {
    const card = MACHINE_CARDS.find(m => m.id === selectedMachineId)!;
    let label = card.label;
    if (isLeatherMachine && machineConfig?.leatherMachine.ballTypeSelectionEnabled) {
      label += ` (${ballType === 'LEATHER' ? 'Leather' : 'Machine'})`;
    }
    if (showPitchSelection) {
      const pt = PITCH_TYPE_LABELS[pitchType];
      label += ` - ${pt?.label || pitchType}`;
    }
    return label;
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-5 pb-28">
      {/* Background gradient */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-[#0a1628] via-[#132240] to-[#0d1f3c]"></div>
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(212,168,67,0.05),transparent_60%)]"></div>

      {/* Page Header */}
      {isBookingForOther && (
        <div className="mb-6 px-4 py-3 bg-accent/10 border border-accent/20 rounded-xl flex items-center gap-3">
          <UserCircle className="w-5 h-5 text-accent" />
          <div>
            <p className="text-[10px] font-bold text-accent uppercase tracking-wider">Admin Mode</p>
            <p className="text-sm font-medium text-white">Booking for: <span className="text-accent">{userName}</span></p>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
          <Calendar className="w-4 h-4 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">Book a Slot</h1>
          <p className="text-[11px] text-slate-400">Select date, machine & time</p>
        </div>
      </div>

      {/* Machine Selection - 2x2 Compact with Images */}
      <div className="mb-4">
        <label className="block text-[10px] font-medium text-slate-500 mb-2 uppercase tracking-wider">Machine</label>
        <div className="grid grid-cols-2 gap-2">
          {MACHINE_CARDS.map((card) => {
            const isSelected = selectedMachineId === card.id;
            return (
              <button
                key={card.id}
                onClick={() => handleMachineSelect(card.id)}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all cursor-pointer text-left ${
                  isSelected
                    ? `${card.activeBg} ring-2 ${card.activeRing} shadow-sm`
                    : 'bg-white/[0.04] border border-white/[0.08] hover:border-accent/30'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={card.image}
                  alt={card.label}
                  className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${card.dotColor}`} />
                    <span className={`text-[11px] font-bold truncate ${isSelected ? 'text-white' : 'text-slate-300'}`}>{card.label}</span>
                  </div>
                  <p className={`text-[9px] ml-3.5 ${isSelected ? 'text-slate-400' : 'text-slate-600'}`}>{card.shortLabel}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Options */}
      <div className="mb-4 space-y-2.5">
        {/* Ball Type - for leather machines when enabled */}
        {isLeatherMachine && machineConfig?.leatherMachine.ballTypeSelectionEnabled && (
          <div>
            <label className="block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider">Ball Type</label>
            <div className="flex gap-2">
              {BALL_TYPES.filter(t => isLeatherMachine ? (t.value !== 'TENNIS') : (t.value === 'TENNIS')).map((type) => (
                <button
                  key={type.value}
                  onClick={() => { setBallType(type.value); setSelectedSlots([]); }}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    ballType === type.value
                      ? 'bg-accent text-primary shadow-sm'
                      : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-accent/20'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${type.color}`}></span>
                  {type.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Pitch Type - shown when machine has multiple enabled pitch types */}
        {showPitchSelection && (
          <div>
            <label className="block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider">Pitch Type</label>
            <div className="flex gap-2">
              {enabledPitchTypes.map((pt) => {
                const info = PITCH_TYPE_LABELS[pt] || { label: pt, color: 'bg-slate-500' };
                return (
                  <button
                    key={pt}
                    onClick={() => { setPitchType(pt); setSelectedSlots([]); }}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      pitchType === pt
                        ? 'bg-accent text-primary shadow-sm'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-accent/20'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${info.color}`}></span>
                    {info.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Pitch Type - auto-selected indicator when only one pitch type configured */}
        {showPitchIndicator && (
          <div>
            <label className="block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider">Pitch Type</label>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-accent/15 text-accent border border-accent/20">
                <Check className="w-3.5 h-3.5" />
                <span className={`w-1.5 h-1.5 rounded-full ${(PITCH_TYPE_LABELS[enabledPitchTypes[0]] || { color: 'bg-slate-500' }).color}`}></span>
                {(PITCH_TYPE_LABELS[enabledPitchTypes[0]] || { label: enabledPitchTypes[0] }).label}
                <span className="text-[10px] text-slate-500 font-normal ml-1">(Auto-selected)</span>
              </div>
            </div>
          </div>
        )}

        {/* Operation Mode - for tennis machines */}
        {!isLeatherMachine && (
          <div>
            <label className="block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider">Operation Mode</label>
            <div className="flex gap-2">
              <button
                onClick={() => { setOperationMode('WITH_OPERATOR'); setSelectedSlots([]); }}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  operationMode === 'WITH_OPERATOR'
                    ? 'bg-accent text-primary shadow-sm'
                    : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-accent/20'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                With Operator
              </button>
              <button
                onClick={() => { setOperationMode('SELF_OPERATE'); setSelectedSlots([]); }}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  operationMode === 'SELF_OPERATE'
                    ? 'bg-accent text-primary shadow-sm'
                    : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-accent/20'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
                Self Operate
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Self Operate Warning */}
      {operationMode === 'SELF_OPERATE' && !isLeatherMachine && (
        <div className="mb-4 px-3 py-3 bg-red-500/15 border-2 border-red-500/40 rounded-lg flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-red-400">Self Operate Mode</p>
            <p className="text-xs text-red-300 mt-0.5">
              No machine operator will be provided. You must operate the bowling machine yourself. Please ensure you are familiar with machine operation before booking.
            </p>
          </div>
        </div>
      )}

      {/* Date Selector */}
      <div className="mb-5">
        <label className="block text-[10px] font-medium text-slate-500 mb-2 uppercase tracking-wider">Date</label>
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
          {[0, 1, 2, 3, 4, 5, 6].map((days) => {
            const date = addDays(new Date(), days);
            const isSelected = format(selectedDate, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd');
            const isToday = days === 0;
            return (
              <button
                key={days}
                onClick={() => setSelectedDate(date)}
                className={`flex-shrink-0 w-16 py-3 rounded-xl text-center transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-accent text-primary shadow-md shadow-accent/20'
                    : 'bg-white/[0.04] text-slate-300 border border-white/[0.08] hover:border-accent/30'
                }`}
              >
                <div className={`text-[10px] uppercase font-medium ${isSelected ? 'text-primary/70' : 'text-slate-500'}`}>
                  {isToday ? 'Today' : format(date, 'EEE')}
                </div>
                <div className="text-lg font-bold mt-0.5">{format(date, 'd')}</div>
                <div className={`text-[10px] ${isSelected ? 'text-primary/60' : 'text-slate-500'}`}>
                  {format(date, 'MMM')}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Slots Grid */}
      <div className="mb-5">
        <label className="block text-[10px] font-medium text-slate-500 mb-2 uppercase tracking-wider">
          Available Slots
        </label>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mb-2" />
            <span className="text-sm">Loading slots...</span>
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <p className="text-red-400 text-sm">{error}</p>
            <button onClick={fetchSlots} className="mt-3 text-sm text-accent font-medium cursor-pointer">Try again</button>
          </div>
        ) : slots.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
              <Calendar className="w-5 h-5 text-slate-500" />
            </div>
            <p className="text-sm text-slate-400">No slots available for this date</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {slots.map((slot) => {
              const isSelected = selectedSlots.some(s => s.startTime === slot.startTime);
              const isBooked = slot.status === 'Booked';
              const isOperatorUnavailable = slot.status === 'OperatorUnavailable';
              const isDisabled = isBooked || isOperatorUnavailable || bookingLoading;
              const displayPrice = getSlotDisplayPrice(slot);

              const showOperatorWarning = !isLeatherMachine &&
                !isBooked && !isOperatorUnavailable &&
                !slot.operatorAvailable &&
                operationMode === 'WITH_OPERATOR';

              return (
                <button
                  key={slot.startTime}
                  disabled={isDisabled}
                  onClick={() => handleToggleSlot(slot)}
                  className={`relative p-3.5 rounded-xl transition-all text-left cursor-pointer ${
                    isBooked || isOperatorUnavailable
                      ? 'bg-white/[0.02] border border-white/[0.05] cursor-not-allowed'
                      : isSelected
                      ? 'bg-accent text-primary shadow-md shadow-accent/20 border border-accent'
                      : showOperatorWarning
                      ? 'bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/30 active:scale-[0.97]'
                      : 'bg-white/[0.04] border border-white/[0.08] hover:border-accent/40 active:scale-[0.97]'
                  }`}
                >
                  {isSelected && (
                    <div className="absolute top-2 right-2">
                      <Check className="w-4 h-4" />
                    </div>
                  )}
                  {(showOperatorWarning || (!isBooked && !isOperatorUnavailable && !slot.operatorAvailable && !isLeatherMachine)) && !isSelected && (
                    <div className="absolute top-2 right-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    </div>
                  )}
                  <div className={`text-sm font-bold ${isBooked || isOperatorUnavailable ? 'text-slate-600' : isSelected ? '' : 'text-white'}`}>
                    {format(parseISO(slot.startTime), 'HH:mm')}
                  </div>
                  <div className={`text-[10px] mt-0.5 ${
                    isBooked || isOperatorUnavailable ? 'text-slate-600' : isSelected ? 'text-primary/70' : 'text-slate-400'
                  }`}>
                    to {format(parseISO(slot.endTime), 'HH:mm')}
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                      isOperatorUnavailable ? 'text-amber-400' :
                      isBooked ? 'text-red-400' :
                      isSelected ? 'text-primary/80' :
                      !slot.operatorAvailable && !isLeatherMachine ? 'text-amber-400' :
                      'text-green-400'
                    }`}>
                      {isOperatorUnavailable ? 'No Machine Operator' :
                       isBooked ? 'Booked' :
                       isSelected ? 'Selected' :
                       !slot.operatorAvailable && !isLeatherMachine ? 'Self Operate' :
                       'Open'}
                    </span>
                    {!isBooked && !isOperatorUnavailable && (
                      <span className={`text-[10px] font-medium ${
                        isSelected ? 'text-primary/70' : 'text-slate-400'
                      }`}>
                        {selectedPackageId && packageValidation && packageValidation.valid ? 'Package' : `₹${displayPrice}`}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Operator warning for Tennis self-operate slots */}
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

      {/* Operator unavailable warning for Leather Machine */}
      {isLeatherMachine && slots.some(s => s.status === 'OperatorUnavailable') && (
        <div className="mt-4 px-3 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-400">
            Some slots show &ldquo;No Machine Operator&rdquo; because the machine operator is busy with another machine at that time.
            Leather machine always requires a machine operator.
          </p>
        </div>
      )}

      {/* Package Selection */}
      {session && userPackages.length > 0 && (
        <div className="mb-8">
          <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Use a Package</label>
          <div className="relative">
            <select
              value={selectedPackageId}
              onChange={(e) => setSelectedPackageId(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-accent appearance-none transition-all"
            >
              <option value="" className="bg-[#0f1d2f]">Don&apos;t use a package (Direct Payment)</option>
              {userPackages.map((up) => (
                <option key={up.id} value={up.id} className="bg-[#0f1d2f]">
                  {up.packageName} ({up.remainingSessions} sessions left)
                </option>
              ))}
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              <ChevronDown className="w-4 h-4" />
            </div>
          </div>

          {selectedPackageId && (
            <div className="mt-3 p-3 rounded-xl bg-accent/5 border border-accent/20">
              <div className="flex items-center gap-2 mb-1">
                <Package className="w-4 h-4 text-accent" />
                <span className="text-xs font-bold text-accent">Package Selected</span>
              </div>
              {isValidatingPackage ? (
                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Validating package rules...
                </div>
              ) : packageValidation ? (
                packageValidation.valid ? (
                  <div className="space-y-1">
                    <p className="text-[11px] text-green-400 flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Valid for this booking. 1 session per slot will be deducted.
                    </p>
                    {packageValidation.extraCharge > 0 && (
                      <div className="mt-2 pt-2 border-t border-white/5">
                        <p className="text-[11px] font-bold text-amber-400">Extra Charge: ₹{packageValidation.extraCharge}</p>
                        <p className="text-[10px] text-slate-400">{packageValidation.extraChargeType === 'BALL_TYPE' ? 'Leather ball upgrade' : packageValidation.extraChargeType === 'WICKET_TYPE' ? 'Cement wicket upgrade' : 'Evening timing upgrade'}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-red-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {packageValidation.error}
                  </p>
                )
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* Contact + Quote */}
      <div className="mt-8 pt-5 border-t border-white/[0.06] pb-4">
        <p className="text-center text-xs text-slate-500 italic mb-3">&ldquo;Champions Aren&apos;t Born. They&apos;re Built &mdash; Ball by Ball.&rdquo;</p>
        <div className="flex items-center justify-center gap-4 text-[11px] text-slate-500">
          <a href="tel:7058683664" className="flex items-center gap-1 hover:text-accent transition-colors">
            <Phone className="w-3 h-3" />
            7058683664
          </a>
          <a href="tel:7774077995" className="flex items-center gap-1 hover:text-accent transition-colors">
            <Phone className="w-3 h-3" />
            7774077995
          </a>
        </div>
      </div>

      {/* Fixed Bottom Booking Bar */}
      {selectedSlots.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#0f1d2f]/95 backdrop-blur-md border-t border-white/[0.08] p-4 z-40 safe-bottom">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-white">{selectedSlots.length} slot{selectedSlots.length > 1 ? 's' : ''} selected</p>
              <p className="text-[11px] text-slate-400">
                {format(selectedDate, 'EEE, MMM d')} &middot; {getMachineLabel()}
                {!isLeatherMachine && (
                  <span> &middot; {hasSelectedSlotsWithoutOperator ? 'Mixed modes' : operationMode === 'WITH_OPERATOR' ? 'With Operator' : 'Self Operate'}</span>
                )}
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                <IndianRupee className="w-3 h-3 text-accent" />
                {selectedPackageId && packageValidation ? (
                  <>
                    <span className="text-sm font-bold text-accent">
                      {packageValidation.extraCharge > 0 ? `Extra: ₹${packageValidation.extraCharge}` : 'Included in Package'}
                    </span>
                    {packageValidation.extraCharge > 0 && (
                      <span className="text-[10px] text-slate-500 line-through ml-1">₹{getTotalPrice().toLocaleString()}</span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-sm font-bold text-accent">{getTotalPrice().toLocaleString()}</span>
                    {hasSavings && (
                      <span className="text-[10px] text-slate-500 line-through ml-1">₹{originalTotal.toLocaleString()}</span>
                    )}
                    {hasSavings && (
                      <span className="text-[10px] text-green-400 ml-1">Save ₹{(originalTotal - getTotalPrice()).toLocaleString()}</span>
                    )}
                  </>
                )}
              </div>
            </div>
            <button
              onClick={handleBook}
              disabled={bookingLoading}
              className="flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-6 py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.97] disabled:opacity-50 cursor-pointer"
            >
              {bookingLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Booking...
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
