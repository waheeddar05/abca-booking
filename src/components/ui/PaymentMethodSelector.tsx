'use client';

import { useState, useEffect } from 'react';
import { CreditCard, Banknote, Wallet } from 'lucide-react';

interface PaymentMethodSelectorProps {
  selected: 'ONLINE' | 'CASH';
  onChange: (method: 'ONLINE' | 'CASH') => void;
  disabled?: boolean;
  showWallet?: boolean;
  totalAmount?: number;
  useWallet?: boolean;
  onUseWalletChange?: (use: boolean) => void;
  walletBalance?: number | null;
  onWalletBalanceLoaded?: (balance: number) => void;
}

export function PaymentMethodSelector({
  selected,
  onChange,
  disabled,
  showWallet,
  totalAmount = 0,
  useWallet = false,
  onUseWalletChange,
  onWalletBalanceLoaded,
}: PaymentMethodSelectorProps) {
  const [walletBalance, setWalletBalance] = useState<number | null>(null);

  useEffect(() => {
    if (showWallet) {
      fetch('/api/wallet')
        .then(res => res.json())
        .then(data => {
          const bal = data.balance ?? null;
          setWalletBalance(bal);
          if (bal != null && onWalletBalanceLoaded) onWalletBalanceLoaded(bal);
        })
        .catch(() => setWalletBalance(null));
    }
  }, [showWallet]);

  const walletDeduction = useWallet && walletBalance ? Math.min(walletBalance, totalAmount) : 0;
  const remainingAmount = totalAmount - walletDeduction;

  return (
    <div className="flex flex-col gap-3">
      {/* Wallet Toggle — shown above payment methods when balance available */}
      {showWallet && walletBalance != null && walletBalance > 0 && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onUseWalletChange?.(!useWallet)}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            useWallet
              ? 'border-green-500/50 bg-green-500/10'
              : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]'
          }`}
        >
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
              useWallet ? 'bg-green-500/20' : 'bg-white/[0.06]'
            }`}
          >
            <Wallet className={`w-4 h-4 ${useWallet ? 'text-green-400' : 'text-slate-400'}`} />
          </div>
          <div className="text-left flex-1">
            <p className={`text-sm font-semibold ${useWallet ? 'text-green-400' : 'text-slate-300'}`}>
              Use Wallet Balance
            </p>
            <p className="text-[10px] text-slate-500">
              Available: ₹{walletBalance.toLocaleString()}
              {useWallet && totalAmount > 0 && (
                <span className="text-green-400 ml-1">
                  · Deducting ₹{walletDeduction.toLocaleString()}
                </span>
              )}
            </p>
          </div>
          <div className="ml-auto flex-shrink-0">
            <div
              className={`w-10 h-6 rounded-full transition-colors relative ${
                useWallet ? 'bg-green-500' : 'bg-white/10'
              }`}
            >
              <div
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                  useWallet ? 'translate-x-[18px]' : 'translate-x-0.5'
                }`}
              />
            </div>
          </div>
        </button>
      )}

      {/* Wallet covers full amount — no other method needed */}
      {useWallet && walletBalance != null && walletBalance >= totalAmount && totalAmount > 0 && (
        <div className="px-4 py-2.5 rounded-xl bg-green-500/5 border border-green-500/20">
          <p className="text-xs text-green-400 font-medium">
            ✓ Wallet balance covers the full amount. No additional payment needed.
          </p>
        </div>
      )}

      {/* Payment methods — only show if there's a remaining amount */}
      {(!useWallet || remainingAmount > 0) && (
        <>
          {useWallet && remainingAmount > 0 && (
            <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">
              Pay remaining ₹{remainingAmount.toLocaleString()} via
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-2.5">
            {/* Pay Online */}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange('ONLINE')}
              className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                selected === 'ONLINE'
                  ? 'border-accent/60 bg-accent/10'
                  : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  selected === 'ONLINE' ? 'bg-accent/20' : 'bg-white/[0.06]'
                }`}
              >
                <CreditCard
                  className={`w-4 h-4 ${selected === 'ONLINE' ? 'text-accent' : 'text-slate-400'}`}
                />
              </div>
              <div className="text-left">
                <p
                  className={`text-sm font-semibold ${
                    selected === 'ONLINE' ? 'text-accent' : 'text-slate-300'
                  }`}
                >
                  Pay Online
                </p>
              </div>
              <div className="ml-auto flex-shrink-0">
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    selected === 'ONLINE' ? 'border-accent' : 'border-white/20'
                  }`}
                >
                  {selected === 'ONLINE' && <div className="w-2.5 h-2.5 rounded-full bg-accent" />}
                </div>
              </div>
            </button>

            {/* Pay at Center */}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange('CASH')}
              className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                selected === 'CASH'
                  ? 'border-accent/60 bg-accent/10'
                  : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  selected === 'CASH' ? 'bg-accent/20' : 'bg-white/[0.06]'
                }`}
              >
                <Banknote
                  className={`w-4 h-4 ${selected === 'CASH' ? 'text-accent' : 'text-slate-400'}`}
                />
              </div>
              <div className="text-left">
                <p
                  className={`text-sm font-semibold ${
                    selected === 'CASH' ? 'text-accent' : 'text-slate-300'
                  }`}
                >
                  Pay at Center
                </p>
                <p className="text-[10px] text-slate-500">Pay when you arrive</p>
              </div>
              <div className="ml-auto flex-shrink-0">
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    selected === 'CASH' ? 'border-accent' : 'border-white/20'
                  }`}
                >
                  {selected === 'CASH' && <div className="w-2.5 h-2.5 rounded-full bg-accent" />}
                </div>
              </div>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
