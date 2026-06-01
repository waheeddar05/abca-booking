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
                {/* Icon removed: the label gets full card width and may wrap to
                    two lines so it stays fully readable at 3-across on phones. */}
                <div className="min-w-0 w-full">
                    <p className="text-xs sm:text-sm font-bold text-white uppercase tracking-wide leading-tight break-words">
                        {label}
                    </p>
                    <p className="text-base sm:text-2xl font-bold text-white break-words mt-1 sm:mt-1.5">
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
        </Link>
    );
}
