'use client';

import { ChevronDown, Package, Loader2, Check, AlertTriangle } from 'lucide-react';
import type { UserPackage, PackageValidationResponse } from '@/lib/schemas';

interface PackageSelectorProps {
  packages: UserPackage[];
  selectedPackageId: string;
  onSelect: (id: string) => void;
  validation: PackageValidationResponse | null;
  isValidating: boolean;
}

export function PackageSelector({
  packages,
  selectedPackageId,
  onSelect,
  validation,
  isValidating,
}: PackageSelectorProps) {
  if (packages.length === 0) return null;

  return (
    <div className="mb-8">
      <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
        Use a Package
      </label>
      <div className="relative">
        <select
          value={selectedPackageId}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-accent appearance-none transition-all"
        >
          <option value="" className="bg-[#0f1d2f]">
            Don&apos;t use a package (Direct Payment)
          </option>
          {packages.map((up) => (
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
                      {validation.extraChargeType === 'BALL_TYPE'
                        ? 'Leather ball upgrade'
                        : validation.extraChargeType === 'WICKET_TYPE'
                        ? 'Cement wicket upgrade'
                        : 'Evening timing upgrade'}
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
