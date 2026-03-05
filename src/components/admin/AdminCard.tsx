'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface AdminCardProps {
    children: React.ReactNode;
    title?: string;
    subtitle?: string;
    icon?: React.ReactNode;
    collapsible?: boolean;
    defaultOpen?: boolean;
    className?: string;
    headerRight?: React.ReactNode;
    accentColor?: string;
    noPadding?: boolean;
}

export function AdminCard({
    children,
    title,
    subtitle,
    icon,
    collapsible = false,
    defaultOpen = true,
    className = '',
    headerRight,
    accentColor,
    noPadding = false,
}: AdminCardProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div
            className={`
        bg-white/[0.03] backdrop-blur-sm rounded-2xl
        border border-white/[0.07]
        hover:border-white/[0.12] transition-all duration-300
        ${accentColor ? `ring-1 ring-inset ${accentColor}` : ''}
        ${className}
      `}
        >
            {title && (
                <div
                    className={`flex items-center gap-3 px-5 py-4 ${collapsible ? 'cursor-pointer select-none' : ''} ${isOpen && !noPadding ? 'border-b border-white/[0.05]' : ''}`}
                    onClick={collapsible ? () => setIsOpen(!isOpen) : undefined}
                >
                    {icon && (
                        <div className="flex-shrink-0">{icon}</div>
                    )}
                    <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-white">{title}</h3>
                        {subtitle && (
                            <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
                        )}
                    </div>
                    {headerRight && <div className="flex-shrink-0">{headerRight}</div>}
                    {collapsible && (
                        <ChevronDown
                            className={`w-4 h-4 text-slate-500 transition-transform duration-300 flex-shrink-0 ${isOpen ? 'rotate-180' : ''
                                }`}
                        />
                    )}
                </div>
            )}
            <div
                className={`
          transition-all duration-300 ease-in-out overflow-hidden
          ${collapsible && !isOpen ? 'max-h-0 opacity-0' : 'max-h-[5000px] opacity-100'}
        `}
            >
                <div className={noPadding ? '' : 'p-5'}>
                    {children}
                </div>
            </div>
        </div>
    );
}
