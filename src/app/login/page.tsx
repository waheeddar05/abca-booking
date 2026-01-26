'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  const [mobileNumber, setMobileNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobileNumber }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send OTP');
      }

      setSuccessMessage(data.debugMessage || 'OTP sent successfully!');
      localStorage.setItem('temp_mobile', mobileNumber);
      setTimeout(() => {
        router.push('/otp');
      }, 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-64px)] bg-slate-950">
      {/* Background Image with Overlay */}
      <div className="fixed inset-0 z-0">
        <img 
          src="https://images.unsplash.com/photo-1531415074968-036ba1b575da?q=80&w=2067&auto=format&fit=crop" 
          alt="Cricket Ground" 
          className="w-full h-full object-cover opacity-20"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-transparent to-slate-950"></div>
      </div>

      {/* Hero Content - Repurposed for Login */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 md:py-8 relative z-10">
        <div className="max-w-4xl mx-auto text-center relative z-10 mb-4 md:mb-8">
          <div className="mb-4 flex justify-center gap-4">
            <div className="w-12 h-12 md:w-16 md:h-16 rounded-full border-2 border-red-600 overflow-hidden shadow-xl transform -rotate-12">
              <img src="https://images.unsplash.com/photo-1593341646782-e0b495cff86d?q=80&w=1000&auto=format&fit=crop" alt="Cricket Ball" className="w-full h-full object-cover" />
            </div>
            <div className="w-12 h-12 md:w-16 md:h-16 rounded-full border-2 border-red-600 overflow-hidden shadow-xl transform rotate-12">
              <img src="https://images.unsplash.com/photo-1624491028326-6dd5d2346ef3?q=80&w=1000&auto=format&fit=crop" alt="Cricket Bat" className="w-full h-full object-cover" />
            </div>
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold mb-2 md:mb-4 leading-tight text-white drop-shadow-lg">
            Master Your Game at ABCA Cricket
          </h1>
          <p className="text-base md:text-xl text-slate-300 max-w-2xl mx-auto">
            Professional-grade bowling machines and practice nets for cricketers of all levels.
          </p>
        </div>

        <div className="w-full max-w-md p-6 md:p-8 space-y-4 md:space-y-6 bg-white rounded-2xl shadow-2xl relative z-10 border-t-4 border-red-600">
          <div className="text-center">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900">Sign In</h2>
            <p className="text-gray-500 mt-1 md:mt-2 text-sm md:text-base font-medium">Book your next practice session</p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-xs md:text-sm text-center">
              {error}
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg text-xs md:text-sm text-center">
              {successMessage}
            </div>
          )}

          <div className="space-y-4">
            <button
                onClick={() => signIn('google', { callbackUrl: '/slots' })}
                disabled={loading}
                className="w-full py-3 md:py-4 border border-gray-300 rounded-xl hover:bg-gray-50 flex items-center justify-center font-bold text-gray-700 transition-all hover:shadow-md disabled:opacity-50"
            >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5 mr-3" />
                Continue with Google
            </button>
          </div>

          <div className="text-center pt-2">
            <span className="text-gray-400 text-xs md:text-sm italic">"Champions are made in the nets"</span>
          </div>
        </div>

        {/* Features Preview - Compact */}
        <div className="mt-8 md:mt-12 grid grid-cols-3 gap-3 md:gap-4 max-w-4xl mx-auto w-full relative z-10 px-4">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-2 md:p-3 border border-white/20 text-center transition-transform hover:scale-105">
            <div className="text-xl md:text-2xl mb-1">🏏</div>
            <h3 className="text-[10px] md:text-xs font-bold text-white uppercase tracking-wider">Advanced Machines</h3>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-2 md:p-3 border border-white/20 text-center transition-transform hover:scale-105">
            <div className="text-xl md:text-2xl mb-1">🏟️</div>
            <h3 className="text-[10px] md:text-xs font-bold text-white uppercase tracking-wider">Quality Nets</h3>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-2 md:p-3 border border-white/20 text-center transition-transform hover:scale-105">
            <div className="text-xl md:text-2xl mb-1">📱</div>
            <h3 className="text-[10px] md:text-xs font-bold text-white uppercase tracking-wider">Easy Booking</h3>
          </div>
        </div>

        {/* Decorative elements - Faded out to prioritize background image */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden opacity-5 pointer-events-none z-0">
           <div className="absolute -top-20 -left-20 w-64 h-64 border-8 border-white rounded-full"></div>
           <div className="absolute top-1/2 right-10 w-32 h-32 border-4 border-white rotate-45"></div>
           <div className="absolute bottom-10 left-1/4 w-48 h-48 border-2 border-white rounded-lg"></div>
        </div>
      </div>

      <footer className="py-4 px-4 bg-black/10 backdrop-blur-md text-center text-white/60 text-[10px] md:text-xs">
        © {new Date().getFullYear()} ABCA Cricket Machine Booking. All rights reserved.
      </footer>
    </div>
  );
}
