'use client';

import { type LucideIcon } from 'lucide-react';

interface AdminToggleProps {
    enabled: boolean;
    onToggle: () => void;
    label: string;
    description?: string;
    icon?: LucideIcon;
    disabled?: boolean;
    size?: 'sm' | 'md';
}

export function AdminToggle({
    enabled,
    onToggle,
    label,
    description,
    icon: Icon,
    disabled = false,
    size = 'md',
}: AdminToggleProps) {
    const isSm = size === 'sm';

    return (
        <div
            className={`flex items-center gap-3 rounded-xl transition-colors ${isSm ? 'py-2' : 'px-3 py-3 hover:bg-white/[0.02]'
                }`}
        >
            {Icon && (
                <div className={`flex-shrink-0 rounded-lg flex items-center justify-center ${isSm ? 'w-7 h-7' : 'w-9 h-9'
                    } ${enabled ? 'bg-accent/15' : 'bg-white/[0.04]'} transition-colors duration-200`}>
                    <Icon className={`${isSm ? 'w-3.5 h-3.5' : 'w-4 h-4'} ${enabled ? 'text-accent' : 'text-slate-500'} transition-colors duration-200`} />
                </div>
            )}
            <div className="flex-1 min-w-0">
                <p className={`font-medium transition-colors duration-200 ${isSm ? 'text-xs' : 'text-sm'
                    } ${enabled ? 'text-white' : 'text-slate-400'}`}>
                    {label}
                </p>
                {description && (
                    <p className={`text-slate-500 mt-0.5 ${isSm ? 'text-[9px]' : 'text-[10px]'}`}>{description}</p>
                )}
            </div>
            <button
                disabled={disabled}
                onClick={onToggle}
                className={`relative rounded-full transition-all duration-300 flex-shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${isSm ? 'w-10 h-5' : 'w-12 h-6'
                    } ${enabled
                        ? 'bg-accent shadow-sm shadow-accent/30'
                        : 'bg-white/[0.1]'
                    }`}
            >
                <div
                    className={`absolute top-0.5 rounded-full bg-white shadow-sm transition-all duration-300 ${isSm ? 'w-4 h-4' : 'w-5 h-5'
                        } ${enabled
                            ? isSm ? 'translate-x-[22px]' : 'translate-x-[26px]'
                            : 'translate-x-0.5'
                        }`}
                />
            </button>
        </div>
    );
}
