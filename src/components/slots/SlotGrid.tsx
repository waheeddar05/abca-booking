'use client';

import { format, parseISO } from 'date-fns';
import { Check, AlertTriangle, Calendar } from 'lucide-react';
import { SlotSkeleton } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import type { AvailableSlot, PackageValidationResponse } from '@/lib/schemas';

interface SlotGridProps {
  slots: AvailableSlot[];
  selectedSlots: AvailableSlot[];
  loading: boolean;
  error: string;
  isLeatherMachine: boolean;
  bookingLoading: boolean;
  selectedPackageId: string;
  packageValidation: PackageValidationResponse | null;
  onToggleSlot: (slot: AvailableSlot) => void;
  onRetry: () => void;
  getSlotDisplayPrice: (slot: AvailableSlot) => number;
}

export function SlotGrid({
  slots,
  selectedSlots,
  loading,
  error,
  isLeatherMachine,
  bookingLoading,
  selectedPackageId,
  packageValidation,
  onToggleSlot,
  onRetry,
  getSlotDisplayPrice,
}: SlotGridProps) {
  return (
    <div className="mb-5">
      <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
        Available Slots
      </label>

      {loading ? (
        <SlotSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : slots.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No slots available for this date"
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {slots.map((slot) => (
            <SlotCard
              key={slot.startTime}
              slot={slot}
              isSelected={selectedSlots.some(s => s.startTime === slot.startTime)}
              isLeatherMachine={isLeatherMachine}
              isDisabled={slot.status === 'Booked' || slot.status === 'OperatorUnavailable' || slot.status === 'Blocked' || bookingLoading}
              selectedPackageId={selectedPackageId}
              packageValidation={packageValidation}
              displayPrice={getSlotDisplayPrice(slot)}
              onToggle={onToggleSlot}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Individual Slot Card ────────────────────────────────
interface SlotCardProps {
  slot: AvailableSlot;
  isSelected: boolean;
  isLeatherMachine: boolean;
  isDisabled: boolean;
  selectedPackageId: string;
  packageValidation: PackageValidationResponse | null;
  displayPrice: number;
  onToggle: (slot: AvailableSlot) => void;
}

function SlotCard({
  slot,
  isSelected,
  isLeatherMachine,
  isDisabled,
  selectedPackageId,
  packageValidation,
  displayPrice,
  onToggle,
}: SlotCardProps) {
  const isBooked = slot.status === 'Booked';
  const isBlocked = slot.status === 'Blocked';
  const isOperatorUnavailable = slot.status === 'OperatorUnavailable';
  const isUnavailable = isBooked || isBlocked || isOperatorUnavailable;
  const noOperator = !slot.operatorAvailable && !isLeatherMachine && !isUnavailable;

  const bgClass = isUnavailable
    ? 'bg-white/[0.02] border border-white/[0.05] cursor-not-allowed'
    : isSelected
    ? 'bg-accent text-primary shadow-md shadow-accent/20 border border-accent'
    : noOperator
    ? 'bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/30 active:scale-[0.97]'
    : 'bg-white/[0.04] border border-white/[0.08] hover:border-accent/40 active:scale-[0.97]';

  const statusLabel = isBlocked
    ? 'Not Available'
    : isOperatorUnavailable
    ? 'No Machine Operator'
    : isBooked
    ? 'Booked'
    : isSelected
    ? 'Selected'
    : noOperator
    ? 'Self Operate'
    : 'Open';

  const statusColor = isBlocked
    ? 'text-red-400'
    : isOperatorUnavailable
    ? 'text-amber-400'
    : isBooked
    ? 'text-red-400'
    : isSelected
    ? 'text-primary/80'
    : noOperator
    ? 'text-amber-400'
    : 'text-green-400';

  return (
    <button
      disabled={isDisabled}
      onClick={() => onToggle(slot)}
      className={`relative p-3.5 rounded-xl transition-all text-left cursor-pointer ${bgClass}`}
    >
      {isSelected && (
        <div className="absolute top-2 right-2">
          <Check className="w-4 h-4" />
        </div>
      )}
      {noOperator && !isSelected && (
        <div className="absolute top-2 right-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
        </div>
      )}

      <div className={`text-sm font-bold ${isUnavailable ? 'text-slate-600' : isSelected ? '' : 'text-white'}`}>
        {format(parseISO(slot.startTime), 'HH:mm')}
      </div>
      <div className={`text-[10px] mt-0.5 ${
        isUnavailable ? 'text-slate-600' : isSelected ? 'text-primary/70' : 'text-slate-400'
      }`}>
        to {format(parseISO(slot.endTime), 'HH:mm')}
      </div>

      <div className="flex items-center justify-between mt-1.5">
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${statusColor}`}>
          {statusLabel}
        </span>
        {!isUnavailable && (
          <span className={`text-[10px] font-medium ${isSelected ? 'text-primary/70' : 'text-slate-400'}`}>
            {selectedPackageId && packageValidation?.valid ? 'Package' : `₹${displayPrice}`}
          </span>
        )}
      </div>
    </button>
  );
}
