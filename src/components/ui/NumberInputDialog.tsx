'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';

interface NumberInputDialogProps {
  open: boolean;
  title: string;
  label: string;
  placeholder?: string;
  confirmLabel?: string;
  variant?: 'default' | 'danger';
  onConfirm: (value: number) => void;
  onCancel: () => void;
}

export function NumberInputDialog({
  open,
  title,
  label,
  placeholder = 'Enter a number...',
  confirmLabel = 'Confirm',
  variant = 'default',
  onConfirm,
  onCancel,
}: NumberInputDialogProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  }, [onCancel]);

  const handleSubmit = () => {
    const num = parseInt(value);
    if (!isNaN(num) && num > 0) {
      onConfirm(num);
    }
  };

  if (!open) return null;

  const isDanger = variant === 'danger';

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-[#0f1d2f] border border-white/[0.12] rounded-2xl w-full max-w-xs p-5 shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-base font-bold text-white">{title}</h2>
          <button
            onClick={onCancel}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-400 mb-1.5">{label}</label>
          <input
            ref={inputRef}
            type="number"
            min="1"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            className="w-full bg-white/[0.04] border border-white/[0.1] rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-300 bg-white/[0.06] hover:bg-white/[0.1] rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!value || parseInt(value) <= 0}
            className={`flex-1 px-4 py-2.5 text-sm font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-50 ${
              isDanger
                ? 'bg-red-500 hover:bg-red-400 text-white'
                : 'bg-accent hover:bg-accent-light text-primary'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
