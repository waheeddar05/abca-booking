'use client';

import { memo } from 'react';
import { MACHINE_CARDS, type MachineCard } from '@/lib/client-constants';
import type { MachineId } from '@/lib/schemas';

interface MachineSelectorProps {
  selectedMachineId: MachineId;
  onSelect: (id: MachineId) => void;
}

export const MachineSelector = memo(function MachineSelector({ selectedMachineId, onSelect }: MachineSelectorProps) {
  return (
    <div className="mb-4" role="radiogroup" aria-label="Machine Type">
      <label className="block text-[10px] font-medium text-accent mb-1 uppercase tracking-wider">
        Machine Type
      </label>

      {/* Single grid: max two boxes per row, remaining wrap to the next row */}
      <div className="grid grid-cols-2 gap-2">
        {MACHINE_CARDS.map((card) => (
          <MachineCardButton
            key={card.id}
            card={card}
            isSelected={selectedMachineId === card.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
});

const MachineCardButton = memo(function MachineCardButton({
  card,
  isSelected,
  onSelect,
}: {
  card: MachineCard;
  isSelected: boolean;
  onSelect: (id: MachineId) => void;
}) {
  return (
    <button
      role="radio"
      aria-checked={isSelected}
      aria-label={`${card.label} – ${card.shortLabel}`}
      onClick={() => onSelect(card.id)}
      className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold border cursor-pointer transition-all ${
        isSelected
          ? 'bg-accent text-primary border-accent shadow-sm'
          : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:border-accent/20'
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={card.image}
        alt={card.label}
        className="w-6 h-6 rounded-md object-cover flex-shrink-0 bg-white/5"
      />
      <span className="leading-tight text-left min-w-0">
        <span className="block truncate">{card.label}</span>
        <span className={`block text-[10px] font-medium truncate ${isSelected ? 'text-primary/70' : 'text-slate-500'}`}>
          {card.shortLabel}
        </span>
      </span>
    </button>
  );
});
