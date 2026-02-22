'use client';

import { addDays } from 'date-fns';
import { format } from 'date-fns';

interface DateSelectorProps {
  selectedDate: Date;
  onSelect: (date: Date) => void;
  daysAhead?: number;
}

export function DateSelector({ selectedDate, onSelect, daysAhead = 7 }: DateSelectorProps) {
  return (
    <div className="mb-5">
      <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
        Date
      </label>
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
        {Array.from({ length: daysAhead }).map((_, days) => {
          const date = addDays(new Date(), days);
          const isSelected = format(selectedDate, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd');
          const isToday = days === 0;

          return (
            <button
              key={days}
              onClick={() => onSelect(date)}
              className={`flex-shrink-0 w-16 py-3 rounded-xl text-center transition-all cursor-pointer ${
                isSelected
                  ? 'bg-accent text-primary shadow-md shadow-accent/20'
                  : 'bg-white/[0.04] text-slate-300 border border-white/[0.08] hover:border-accent/30'
              }`}
            >
              <div className={`text-[10px] uppercase font-medium ${isSelected ? 'text-primary/70' : 'text-slate-500'}`}>
                {isToday ? 'Today' : format(date, 'EEE')}
              </div>
              <div className="text-lg font-bold mt-0.5">{format(date, 'd')}</div>
              <div className={`text-[10px] ${isSelected ? 'text-primary/60' : 'text-slate-500'}`}>
                {format(date, 'MMM')}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
