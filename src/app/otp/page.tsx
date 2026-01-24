'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function OtpPage() {
  const [otp, setOtp] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    const mobile = localStorage.getItem('temp_mobile');
    if (!mobile) {
      router.push('/login');
    } else {
      setMobileNumber(mobile);
    }
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobileNumber, otp }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Invalid OTP');
      }

      localStorage.removeItem('temp_mobile');
      router.push('/slots');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)] bg-slate-900 px-4 overflow-hidden">
      <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-2xl shadow-2xl border-t-4 border-red-600">
        <h1 className="text-3xl font-bold text-center text-gray-900">Verify OTP</h1>
        <p className="text-sm text-center text-gray-500 font-medium">
          Enter the code sent to <span className="text-red-600 font-bold">{mobileNumber}</span>
        </p>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="otp" className="block text-sm font-semibold text-gray-700 mb-2 text-center">
              6-Digit Security Code
            </label>
            <input
              id="otp"
              type="text"
              required
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              className="w-full px-4 py-4 border-2 border-gray-100 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 text-center text-3xl tracking-[0.5em] font-mono outline-none transition-all"
              placeholder="000000"
              disabled={loading}
            />
          </div>
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm text-center">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 text-white bg-red-600 rounded-xl font-bold text-lg hover:bg-red-700 transition-all transform active:scale-95 shadow-lg disabled:bg-red-400"
          >
            {loading ? 'Verifying...' : 'Verify & Access'}
          </button>
        </form>
        
        <div className="text-center">
          <button 
            onClick={() => router.push('/login')}
            className="text-sm text-gray-500 hover:text-red-600 transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    </div>
  );
}
