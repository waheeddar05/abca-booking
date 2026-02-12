'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-4 text-center">
      {/* Background gradient */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-[#0a1628] via-[#132240] to-[#0d1f3c]"></div>
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(212,168,67,0.05),transparent_60%)]"></div>

      <div className="bg-white/[0.04] backdrop-blur-sm p-8 rounded-2xl max-w-md w-full border border-red-500/20">
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-8 w-8 text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Something went wrong</h2>
        <p className="text-slate-400 mb-6">
          We apologize for the inconvenience. An unexpected error has occurred.
        </p>

        {error.digest && (
          <div className="mb-6 p-2 bg-white/[0.04] rounded-lg border border-white/[0.08]">
            <p className="text-xs text-slate-500 font-mono">Reference ID: {error.digest}</p>
          </div>
        )}

        <div className="flex flex-col space-y-3">
          <button
            onClick={() => reset()}
            className="w-full bg-accent hover:bg-accent-light text-primary font-semibold py-2.5 px-4 rounded-xl transition-all active:scale-[0.98] cursor-pointer"
          >
            Try again
          </button>
          <Link
            href="/"
            className="w-full bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 font-semibold py-2.5 px-4 rounded-xl transition-all text-center"
          >
            Return to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
