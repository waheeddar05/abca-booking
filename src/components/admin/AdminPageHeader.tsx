'use client';

import { type LucideIcon } from 'lucide-react';

interface AdminPageHeaderProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: React.ReactNode;
  iconColor?: string;
  iconBg?: string;
}

export function AdminPageHeader({
  icon: Icon,
  title,
  description,
  children,
  iconColor = 'text-accent',
  iconBg = 'bg-accent/10',
}: AdminPageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl ${iconBg} flex items-center justify-center shadow-lg shadow-accent/5`}>
          <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${iconColor}`} />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight">{title}</h1>
          {description && (
            <p className="text-xs text-slate-400 mt-0.5">{description}</p>
          )}
        </div>
      </div>
      {children && (
        <div className="flex items-center gap-2 flex-shrink-0">{children}</div>
      )}
    </div>
  );
}
