'use client';

import { Package } from 'lucide-react';

interface PackageFirstBookingBannerProps {
  packageName: string;
}

export function PackageFirstBookingBanner({ packageName }: PackageFirstBookingBannerProps) {
  return (
    <div className="mb-4 px-4 py-3 bg-purple-500/10 border border-purple-500/20 rounded-xl flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center flex-shrink-0">
        <Package className="w-4 h-4 text-purple-400" />
      </div>
      <div>
        <p className="text-sm font-semibold text-purple-300">
          Package: {packageName}
        </p>
        <p className="text-xs text-purple-400/80 mt-0.5">
          Package activation begins with your first booking.
        </p>
      </div>
    </div>
  );
}
