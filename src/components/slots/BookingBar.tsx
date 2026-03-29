'use client';

import { format } from 'date-fns';
import { IndianRupee, Check, Loader2 } from 'lucide-react';
import type { AvailableSlot, PackageValidationResponse } from '@/lib/schemas';

interface BookingBarProps {
  selectedSlots: AvailableSlot[];
  selectedDate: Date;
  machineLabel: string;
  isLeatherMachine: boolean;
  operationMode: 'WITH_OPERATOR' | 'SELF_OPERATE';
  hasSelectedSlotsWithoutOperator: boolean;
  totalPrice: number;
  originalTotal: number;
  hasSavings: boolean;
  recurringDiscount?: number;
  selectedPackageId: string;
  packageValidation: PackageValidationResponse | null;
  bookingLoading: boolean;
  isSuperAdmin?: boolean;
  kitRentalTotal?: number;
  onBook: () => void;
}

export function BookingBar({
  selectedSlots,
  selectedDate,
  machineLabel,
  isLeatherMachine,
  operationMode,
  hasSelectedSlotsWithoutOperator,
  totalPrice,
  originalTotal,
  hasSavings,
  recurringDiscount = 0,
  selectedPackageId,
  packageValidation,
  bookingLoading,
  isSuperAdmin,
  kitRentalTotal = 0,
  onBook,
}: BookingBarProps) {
  if (selectedSlots.length === 0) return null;

  const savings = originalTotal - totalPrice;
  const displayTotal = totalPrice + kitRentalTotal;

  return (
    <div className="fixed bottom-0 md:bottom-0 left-0 right-0 bg-[#0f1d2f]/95 backdrop-blur-md border-t border-white/[0.08] p-4 z-40 mb-[60px] md:mb-0 safe-bottom">
      <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-white">
            {selectedSlots.length} slot{selectedSlots.length > 1 ? 's' : ''} selected
          </p>
          <p className="text-[11px] text-slate-400">
            {format(selectedDate, 'EEE, MMM d')} &middot; {machineLabel}
            {!isLeatherMachine && (
              <span>
                {' '}&middot;{' '}
                {hasSelectedSlotsWithoutOperator
                  ? 'Mixed modes'
                  : operationMode === 'WITH_OPERATOR'
                  ? 'With Operator'
                  : 'Self Operate'}
              </span>
            )}
          </p>

          <div className="flex items-center gap-1 mt-0.5">
            {isSuperAdmin ? (
              <span className="text-sm font-bold text-green-400">FREE</span>
            ) : (
              <>
                <IndianRupee className="w-3 h-3 text-accent" />
                {selectedPackageId && packageValidation ? (
                  <>
                    <span className="text-sm font-bold text-accent">
                      {packageValidation.extraCharge && packageValidation.extraCharge > 0
                        ? `Extra: ₹${packageValidation.extraCharge}`
                        : 'Included in Package'}
                    </span>
                    {packageValidation.extraCharge && packageValidation.extraCharge > 0 && (
                      <span className="text-[10px] text-slate-500 line-through ml-1">
                        ₹{totalPrice.toLocaleString()}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-sm font-bold text-accent">
                      {displayTotal.toLocaleString()}
                    </span>
                    {hasSavings && (
                      <>
                        <span className="text-[10px] text-slate-500 line-through ml-1">
                          ₹{(originalTotal + kitRentalTotal).toLocaleString()}
                        </span>
                        <span className="text-[10px] text-green-400 ml-1">
                          Save ₹{savings.toLocaleString()}
                        </span>
                      </>
                    )}
                    {recurringDiscount > 0 && (
                      <span className="text-[10px] text-emerald-400 ml-1">
                        (incl. Slot Discount: -₹{recurringDiscount})
                      </span>
                    )}
                    {kitRentalTotal > 0 && (
                      <span className="text-[10px] text-amber-400 ml-1">
                        (incl. Kit: +₹{kitRentalTotal})
                      </span>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <button
          onClick={onBook}
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
  );
}
