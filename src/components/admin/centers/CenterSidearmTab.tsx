'use client';

import { useState, useEffect } from 'react';
import { Calendar, ListOrdered, CalendarClock, Loader2, Save, Check, ChevronUp, ChevronDown, Trash2, Plus, Pencil, Wrench } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { getISTDateString } from '@/lib/time';
import { Field, TextInput, SecondaryButton, PrimaryButton } from './centerForms';

type TabKey = 'schedule' | 'priority' | 'dateOverrides';

const TABS: { key: TabKey; label: string; icon: any }[] = [
  { key: 'schedule', label: 'Schedule', icon: Calendar },
  { key: 'priority', label: 'Priority', icon: ListOrdered },
  { key: 'dateOverrides', label: 'Date Overrides', icon: CalendarClock },
];

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NUMBERS = [0, 1, 2, 3, 4, 5, 6];

export function CenterSidearmTab({ centerId }: { centerId: string }) {
  const [activeTab, setActiveTab] = useState<TabKey>('schedule');
  const toast = useToast();
  
  // This is a placeholder implementation that should mirror AdminOperators logic
  // but scoped to SIDEARM_SPECIALIST and this center.
  // In a real implementation, we would fetch and save to APIs that handle sidearm specifically.
  
  return (
    <div className="space-y-5">
      <div className="flex gap-1 bg-white/[0.03] p-1 rounded-lg">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all cursor-pointer ${
                activeTab === tab.key
                  ? 'bg-accent/15 text-accent'
                  : 'text-slate-400 hover:text-slate-300 hover:bg-white/[0.03]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-8 text-center">
        <UserCog className="w-12 h-12 text-slate-700 mx-auto mb-4" />
        <h3 className="text-sm font-semibold text-white mb-1">Sidearm Specialist Availability</h3>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">
          This section allows you to manage the schedule, priority, and date overrides specifically for Sidearm Specialists at this center.
        </p>
        <div className="mt-6">
           <Banner kind="info">
             Sidearm availability management is currently being unified with the global operator system. 
             Specialists can be managed via the main Operators tab for now.
           </Banner>
        </div>
      </div>
    </div>
  );
}

function Banner({ kind, children }: { kind: 'info'; children: React.ReactNode }) {
  return (
    <div className="bg-sky-500/10 border border-sky-500/20 rounded-lg p-3 text-[11px] text-sky-300 text-left">
      {children}
    </div>
  );
}

import { UserCog } from 'lucide-react';
