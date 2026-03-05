'use client';

import { CreditCard, Banknote, Wallet } from 'lucide-react';

interface PaymentMethodSelectorProps {
  selected: 'ONLINE' | 'CASH' | 'WALLET';
  onChange: (method: 'ONLINE' | 'CASH' | 'WALLET') => void;
  disabled?: boolean;
  walletBalance?: number | null;
  walletEnabled?: boolean;
}

export function PaymentMethodSelector({ selected, onChange, disabled, walletBalance, walletEnabled }: PaymentMethodSelectorProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
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
                selected === 'ONLINE'
                  ? 'border-accent'
                  : 'border-white/20'
              }`}
            >
              {selected === 'ONLINE' && (
                <div className="w-2.5 h-2.5 rounded-full bg-accent" />
              )}
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
                selected === 'CASH'
                  ? 'border-accent'
                  : 'border-white/20'
              }`}
            >
              {selected === 'CASH' && (
                <div className="w-2.5 h-2.5 rounded-full bg-accent" />
              )}
            </div>
          </div>
        </button>
      </div>

      {/* Pay with Wallet */}
      {walletEnabled && walletBalance != null && walletBalance > 0 && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange('WALLET')}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            selected === 'WALLET'
              ? 'border-green-500/60 bg-green-500/10'
              : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]'
          }`}
        >
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
              selected === 'WALLET' ? 'bg-green-500/20' : 'bg-white/[0.06]'
            }`}
          >
            <Wallet
              className={`w-4 h-4 ${selected === 'WALLET' ? 'text-green-400' : 'text-slate-400'}`}
            />
          </div>
          <div className="text-left">
            <p
              className={`text-sm font-semibold ${
                selected === 'WALLET' ? 'text-green-400' : 'text-slate-300'
              }`}
            >
              Pay with Wallet
            </p>
            <p className="text-[10px] text-slate-500">Balance: ₹{walletBalance.toLocaleString()}</p>
          </div>
          <div className="ml-auto flex-shrink-0">
            <div
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                selected === 'WALLET'
                  ? 'border-green-500'
                  : 'border-white/20'
              }`}
            >
              {selected === 'WALLET' && (
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
              )}
            </div>
          </div>
        </button>
      )}
    </div>
  );
}
