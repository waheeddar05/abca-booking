'use client';

import { marketplaceCategoryLabel, type MarketplaceCategoryCount } from '@/lib/marketplace';

interface CategoryChipsProps {
  /** Categories that currently have products (from the catalog API). */
  categories: MarketplaceCategoryCount[];
  /** Selected category code, or '' for "All". */
  selected: string;
  onSelect: (category: string) => void;
  className?: string;
}

/**
 * The /shop filter bar: "All" plus one chip per category that has
 * products, each with its count. A single horizontally-scrolling row so
 * ten categories still fit a 360px phone without wrapping the grid down
 * the page. The counts come from the API and ignore the category filter
 * (they honour the search), so they stay put while a chip is selected.
 *
 * A selected category that the search has emptied would otherwise vanish
 * from the list with no way to deselect it, so it is kept as a zero-count
 * chip until the user clears it.
 */
export function CategoryChips({ categories, selected, onSelect, className = '' }: CategoryChipsProps) {
  const total = categories.reduce((sum, c) => sum + c.count, 0);
  const chips: MarketplaceCategoryCount[] =
    selected && !categories.some((c) => c.value === selected)
      ? [...categories, { value: selected, label: marketplaceCategoryLabel(selected), count: 0 }]
      : categories;

  return (
    <div
      className={`flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1 ${className}`}
      role="group"
      aria-label="Filter by category"
    >
      <Chip label="All" count={total} active={selected === ''} onClick={() => onSelect('')} />
      {chips.map((c) => (
        <Chip
          key={c.value}
          label={c.label}
          count={c.count}
          active={selected === c.value}
          onClick={() => onSelect(c.value)}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer active:scale-[0.98] ${
        active
          ? 'bg-accent/15 border-accent/40 text-accent'
          : 'bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.08] hover:text-white'
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-px text-[10px] tabular-nums ${
          active ? 'bg-accent/20 text-accent' : 'bg-white/[0.06] text-slate-400'
        }`}
      >
        {count}
      </span>
    </button>
  );
}
