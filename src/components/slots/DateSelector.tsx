'use client';

import { memo, useMemo } from 'react';
import { addDays } from 'date-fns';
import { format } from 'date-fns';

interface DateSelectorProps {
  selectedDate: Date;
  onSelect: (date: Date) => void;
  daysAhead?: number;
}

export const DateSelector = memo(function DateSelector({ selectedDate, onSelect, daysAhead = 15 }: DateSelectorProps) {
  const selectedStr = format(selectedDate, 'yyyy-MM-dd');
  const dates = useMemo(() =>
    Array.from({ length: daysAhead }, (_, days) => addDays(new Date(), days)),
    [daysAhead]
  );

  return (
    <div className="mb-5">
      <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
        Date
      </label>
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
        {dates.map((date, days) => {
          const isSelected = selectedStr === format(date, 'yyyy-MM-dd');
          const isToday = days === 0;

          return (
            <button
              key={days}
              onClick={() => onSelect(date)}
              className={`flex-shrink-0 w-14 py-1.5 rounded-lg text-center transition-all cursor-pointer ${
                isSelected
                  ? 'bg-accent text-primary shadow-md shadow-accent/20'
                  : 'bg-white/[0.04] text-slate-300 border border-white/[0.08] hover:border-accent/30'
              }`}
            >
              <div className={`text-[9px] uppercase font-medium ${isSelected ? 'text-primary/70' : 'text-slate-500'}`}>
                {isToday ? 'Today' : format(date, 'EEE')}
              </div>
              <div className="text-base font-bold leading-tight">{format(date, 'd')}</div>
              <div className={`text-[9px] ${isSelected ? 'text-primary/60' : 'text-slate-500'}`}>
                {format(date, 'MMM')}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});
