'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

export function BackButton() {
  const router = useRouter();

  return (
    <button
      onClick={() => router.back()}
      className="md:hidden flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer mb-3"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      Back
    </button>
  );
}
