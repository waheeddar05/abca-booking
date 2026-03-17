'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { type LucideIcon } from 'lucide-react';

interface AdminStatCardProps {
    label: string;
    value: number | string;
    icon: LucideIcon;
    href: string;
    gradient: string;
    iconColor: string;
    loading?: boolean;
    prefix?: string;
    isText?: boolean;
    delay?: number;
}

function useCountUp(target: number, duration: number = 800, delay: number = 0) {
    const [count, setCount] = useState(0);
    const frameRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        if (target === 0) { setCount(0); return; }

        const timeout = setTimeout(() => {
            const startTime = performance.now();
            const animate = (currentTime: number) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                // Ease out cubic
                const eased = 1 - Math.pow(1 - progress, 3);
                setCount(Math.round(eased * target));

                if (progress < 1) {
                    frameRef.current = requestAnimationFrame(animate);
                }
            };
            frameRef.current = requestAnimationFrame(animate);
        }, delay);

        return () => {
            clearTimeout(timeout);
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
        };
    }, [target, duration, delay]);

    return count;
}

export function AdminStatCard({
    label,
    value,
    icon: Icon,
    href,
    gradient,
    iconColor,
    loading = false,
    prefix,
    isText = false,
    delay = 0,
}: AdminStatCardProps) {
    const numericValue = typeof value === 'number' ? value : 0;
    const animatedCount = useCountUp(isText ? 0 : numericValue, 800, delay);

    return (
        <Link
            href={href}
            className="group relative overflow-hidden rounded-xl sm:rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur-sm hover:border-white/[0.15] transition-all duration-300 hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5"
            style={{ animationDelay: `${delay}ms` }}
        >
            {/* Gradient overlay on hover */}
            <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ${gradient}`} />

            <div className="relative p-3 sm:p-4">
                <div className="flex items-center gap-2.5 sm:gap-3">
                    <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl ${gradient} flex items-center justify-center group-hover:scale-110 transition-transform duration-300 flex-shrink-0`}>
                        <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${iconColor}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[9px] sm:text-[10px] font-semibold text-slate-500 uppercase tracking-wider truncate">
                            {label}
                        </p>
                        <p className="text-base sm:text-xl font-bold text-white truncate mt-0.5">
                            {loading ? (
                                <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" />
                            ) : isText ? (
                                <span className={iconColor}>{value}</span>
                            ) : (
                                <>
                                    {prefix}{animatedCount.toLocaleString()}
                                </>
                            )}
                        </p>
                    </div>
                </div>
            </div>
        </Link>
    );
}
