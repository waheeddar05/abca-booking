'use client';

/**
 * Shared form primitives for the center admin tabs.
 * Inlined here so each tab stays focused on its domain logic.
 */

import { type ReactNode } from 'react';

export function FieldLabel({ label, required, help }: { label: string; required?: boolean; help?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 mb-1">
        {label} {required && <span className="text-red-400">*</span>}
      </div>
      {help && <div className="text-[11px] text-slate-500 mb-1">{help}</div>}
    </div>
  );
}

export function Field({
  label,
  required,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  help?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 mb-1">
        {label} {required && <span className="text-red-400">*</span>}
      </div>
      {children}
      {help && <div className="text-[11px] text-slate-500 mt-1">{help}</div>}
    </label>
  );
}

const inputBase =
  'w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white outline-none focus:border-accent/60 focus:bg-white/[0.06]';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputBase} ${props.className ?? ''}`} />;
}

export function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" {...props} className={`${inputBase} ${props.className ?? ''}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputBase} ${props.className ?? ''}`} />;
}

export function SelectInput({
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${inputBase} ${props.className ?? ''}`}>
      {children}
    </select>
  );
}

export function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`px-3 py-2 rounded-xl text-sm font-semibold bg-accent text-black hover:bg-accent/90 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2 ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`px-3 py-2 rounded-xl text-sm text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function DangerButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`px-3 py-2 rounded-xl text-sm font-medium text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function Banner({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'bg-red-500/10 border-red-500/20 text-red-300',
    success: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
    info: 'bg-sky-500/10 border-sky-500/20 text-sky-300',
  }[kind];
  return <div className={`text-sm border rounded-lg p-2 ${styles}`}>{children}</div>;
}
