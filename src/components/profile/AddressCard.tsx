'use client';

import { Briefcase, Home, Loader2, Pencil, Star, Tag, Trash2, type LucideIcon } from 'lucide-react';
import { formatAddressLines, type UserAddressView } from '@/lib/addresses';

export type AddressPendingAction = 'default' | 'delete';

interface AddressCardProps {
  address: UserAddressView;
  /** Which action on THIS card is in flight, if any. */
  pending: AddressPendingAction | null;
  /** True while any address mutation is in flight — every action locks so two can't race. */
  locked: boolean;
  onSetDefault: (address: UserAddressView) => void;
  onEdit: (address: UserAddressView) => void;
  onDelete: (address: UserAddressView) => void;
}

/**
 * Icon for the label pill. A static map lookup, not a factory — the
 * `react-hooks/static-components` rule forbids creating a component from
 * a function call in render.
 */
const LABEL_ICONS: Record<string, LucideIcon> = {
  home: Home,
  work: Briefcase,
  office: Briefcase,
};

const actionClass =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * One saved delivery address: label + Default pills, the postal lines
 * from `formatAddressLines`, and the row of actions. "Set as default" is
 * hidden on the default itself — the API can only *move* the default,
 * never unset it.
 */
export function AddressCard({
  address,
  pending,
  locked,
  onSetDefault,
  onEdit,
  onDelete,
}: AddressCardProps) {
  const [recipient, ...lines] = formatAddressLines(address);
  const label = address.label?.trim() ?? '';
  const LabelIcon = LABEL_ICONS[label.toLowerCase()] ?? Tag;

  return (
    <article
      aria-label={label ? `${label} address` : 'Address'}
      className={`bg-white/[0.04] backdrop-blur-sm rounded-xl border p-3.5 animate-fade-in ${
        address.isDefault ? 'border-accent/30' : 'border-white/[0.08]'
      }`}
    >
      {(label || address.isDefault) && (
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {label && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] border border-white/[0.1] text-slate-300 px-2 py-0.5 text-[10px] font-semibold max-w-full">
              <LabelIcon className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </span>
          )}
          {address.isDefault && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 border border-accent/30 text-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
              <Star className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
              Default
            </span>
          )}
        </div>
      )}

      <p className="text-sm font-semibold text-white break-words">{recipient}</p>
      {lines.map((line, i) => (
        <p key={i} className="text-xs text-slate-400 leading-relaxed break-words">
          {line}
        </p>
      ))}

      <div className="flex items-center gap-1.5 flex-wrap mt-3 pt-3 border-t border-white/[0.06]">
        {!address.isDefault && (
          <button
            type="button"
            onClick={() => onSetDefault(address)}
            disabled={locked}
            className={`${actionClass} bg-accent/10 hover:bg-accent/20 text-accent`}
          >
            {pending === 'default' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Star className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            Set as default
          </button>
        )}
        <button
          type="button"
          onClick={() => onEdit(address)}
          disabled={locked}
          className={`${actionClass} bg-white/[0.06] hover:bg-white/[0.1] text-slate-300`}
        >
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(address)}
          disabled={locked}
          className={`${actionClass} bg-white/[0.04] hover:bg-red-500/10 text-red-400 ml-auto`}
        >
          {pending === 'delete' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          Delete
        </button>
      </div>
    </article>
  );
}
