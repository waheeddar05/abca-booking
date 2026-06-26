'use client';

import { ChevronDown, Package, Loader2, Check, AlertTriangle } from 'lucide-react';
import type { UserPackage, PackageValidationResponse } from '@/lib/schemas';
import { MACHINES } from '@/lib/constants';

interface PackageSelectorProps {
  packages: UserPackage[];
  selectedPackageId: string;
  onSelect: (id: string) => void;
  validation: PackageValidationResponse | null;
  isValidating: boolean;
  // The machine currently being booked + whether it's a leather machine.
  // Used to (a) surface same-ball-type packages bought for a *different*
  // machine and (b) hide cross-ball-type packages that can never apply.
  currentMachineId?: string;
  isLeatherMachine?: boolean;
}

/** Human label for a package's machine, resolved from the legacy enum.
 *  Indexed as a plain string so it tolerates ids outside the enum
 *  (returns the raw value) without a type-juggling cast. */
function machineLabel(machineId: string | null | undefined): string | null {
  if (!machineId) return null;
  const def = (MACHINES as Record<string, { name: string }>)[machineId];
  return def?.name ?? machineId;
}

/** Describe why an upgrade fee applies. Prefers the per-component
 *  breakdown (so stacked upgrades read "different machine + evening
 *  timing upgrade") and falls back to the single extraChargeType. */
function describeExtraCharge(validation: PackageValidationResponse): string {
  const b = validation.breakdown;
  if (b) {
    const parts: string[] = [];
    if (b.machineExtra > 0) parts.push('different machine');
    if (b.ballTypeExtra > 0) parts.push('leather ball');
    if (b.wicketTypeExtra > 0) parts.push('pitch');
    if (b.timingExtra > 0) parts.push('evening timing');
    if (parts.length > 0) return `${parts.join(' + ')} upgrade`;
  }
  switch (validation.extraChargeType) {
    case 'MACHINE':
      return 'Different machine upgrade';
    case 'BALL_TYPE':
      return 'Leather ball upgrade';
    case 'WICKET_TYPE':
      return 'Pitch upgrade';
    case 'TIMING':
      return 'Evening timing upgrade';
    default:
      return 'Upgrade charge';
  }
}

export function PackageSelector({
  packages,
  selectedPackageId,
  onSelect,
  validation,
  isValidating,
  currentMachineId,
  isLeatherMachine,
}: PackageSelectorProps) {
  // A package can only be redeemed on a machine of its own ball type
  // (leather packages on leather machines, tennis on tennis). Show every
  // same-ball-type package — including ones bought for a *different*
  // machine of that ball type, which the user can redeem with a surcharge.
  const compatible =
    isLeatherMachine === undefined
      ? packages
      : packages.filter(
          (up) => up.machineType === (isLeatherMachine ? 'LEATHER' : 'TENNIS'),
        );

  // Never drop the currently-selected package, even if it became
  // incompatible after a machine switch — otherwise the <select> would
  // show a blank value while the package stays selected. Keeping it shown
  // surfaces the validation error instead.
  const visiblePackages =
    selectedPackageId && !compatible.some((p) => p.id === selectedPackageId)
      ? [...compatible, ...packages.filter((p) => p.id === selectedPackageId)]
      : compatible;

  if (visiblePackages.length === 0) return null;

  return (
    <div className="mb-8">
      <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
        Use a Package
      </label>
      <div className="relative">
        <select
          value={selectedPackageId}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-3 text-xs text-white outline-none focus:border-accent appearance-none transition-all truncate"
        >
          <option value="" className="bg-[#0f1d2f]">
            Don&apos;t use a package (Direct Payment)
          </option>
          {visiblePackages.map((up) => {
            const mLabel = machineLabel(up.machineId);
            // Flag packages bought for a different machine so the user
            // understands they're redeeming cross-machine (a surcharge
            // may apply, shown after validation below).
            const crossMachine =
              !!up.machineId && !!currentMachineId && up.machineId !== currentMachineId;
            const suffix = mLabel ? ` · ${mLabel}${crossMachine ? ' pkg' : ''}` : '';
            return (
              <option key={up.id} value={up.id} className="bg-[#0f1d2f]">
                {up.packageName}{suffix} ({up.remainingSessions} sessions left)
              </option>
            );
          })}
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

          {isValidating ? (
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              Validating package rules...
            </div>
          ) : validation ? (
            validation.valid ? (
              <div className="space-y-1">
                <p className="text-[11px] text-green-400 flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  Valid for this booking. 1 session per slot will be deducted.
                </p>
                {validation.extraCharge && validation.extraCharge > 0 && (
                  <div className="mt-2 pt-2 border-t border-white/5">
                    <p className="text-[11px] font-bold text-amber-400">
                      Extra Charge: ₹{validation.extraCharge}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {describeExtraCharge(validation)}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-red-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {validation.error}
              </p>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
