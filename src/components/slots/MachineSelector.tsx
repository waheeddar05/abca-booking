'use client';

import { MACHINE_CARDS, type MachineCard } from '@/lib/client-constants';
import type { MachineId } from '@/lib/schemas';

interface MachineSelectorProps {
  selectedMachineId: MachineId;
  onSelect: (id: MachineId) => void;
}

export function MachineSelector({ selectedMachineId, onSelect }: MachineSelectorProps) {
  const leatherMachines = MACHINE_CARDS.filter(c => c.category === 'LEATHER');
  const tennisMachines = MACHINE_CARDS.filter(c => c.category === 'TENNIS');

  return (
    <div className="mb-4" role="radiogroup" aria-label="Machine Type">
      <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
        Machine Type
      </label>

      {/* Leather Machines */}
      <div className="grid grid-cols-2 gap-1.5 mb-1.5">
        {leatherMachines.map((card) => (
          <MachineCardButton
            key={card.id}
            card={card}
            isSelected={selectedMachineId === card.id}
            onSelect={onSelect}
          />
        ))}
      </div>

      {/* Tennis Machines */}
      <div className="grid grid-cols-2 gap-1.5">
        {tennisMachines.map((card) => (
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
}

function MachineCardButton({
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
      className={`flex items-center gap-1.5 px-1.5 py-1 rounded-lg transition-all cursor-pointer text-left ${
        isSelected
          ? 'bg-accent/15 ring-1 ring-accent/50 shadow-sm'
          : 'bg-white/[0.04] border border-white/[0.08] hover:border-accent/30'
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={card.image}
        alt={card.label}
        className="w-7 h-7 rounded-md object-cover flex-shrink-0"
      />
      <div className="min-w-0">
        <span className={`text-[11px] font-bold leading-tight ${isSelected ? 'text-accent' : 'text-slate-300'}`}>
          {card.label}
        </span>
        <p className={`text-[9px] ${isSelected ? 'text-accent/70' : 'text-slate-500'}`}>
          {card.shortLabel}
        </p>
      </div>
    </button>
  );
}
