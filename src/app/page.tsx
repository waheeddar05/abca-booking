import Link from "next/link";
import { redirect } from "next/navigation";
import { getToken } from "next-auth/jwt";
import { headers, cookies } from "next/headers";
import { verifyToken } from "@/lib/jwt";

export default async function Home() {
  const cookieStore = await cookies();
  const token = await getToken({ 
    req: { 
      headers: await headers(),
      cookies: cookieStore,
    } as any, 
    secret: process.env.NEXTAUTH_SECRET 
  });
  
  const otpTokenStr = cookieStore.get("token")?.value;
  const otpToken = otpTokenStr ? verifyToken(otpTokenStr) as any : null;

  if (token || otpToken) {
    console.log("Home: User is authenticated, redirecting to /slots");
    redirect("/slots");
  }

  console.log("Home: User is NOT authenticated, showing landing page");

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

      {/* Combined Hero & Action Section */}
      <section className="relative flex-1 text-white flex flex-col items-center justify-center px-4 py-12 md:py-0 overflow-hidden z-10">
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <div className="mb-6 flex justify-center gap-4">
            <div className="w-16 h-16 md:w-24 md:h-24 rounded-full border-2 border-red-600 overflow-hidden shadow-xl transform -rotate-12 hover:rotate-0 transition-transform">
              <img src="https://images.unsplash.com/photo-1593341646782-e0b495cff86d?q=80&w=1000&auto=format&fit=crop" alt="Cricket Ball" className="w-full h-full object-cover" />
            </div>
            <div className="w-16 h-16 md:w-24 md:h-24 rounded-full border-2 border-red-600 overflow-hidden shadow-xl transform rotate-12 hover:rotate-0 transition-transform">
              <img src="https://images.unsplash.com/photo-1624491028326-6dd5d2346ef3?q=80&w=1000&auto=format&fit=crop" alt="Cricket Bat" className="w-full h-full object-cover" />
            </div>
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold mb-3 leading-tight drop-shadow-lg">
            Master Your Game at ABCA Cricket
          </h1>
          <p className="text-base md:text-xl mb-6 text-slate-300 max-w-2xl mx-auto">
            Professional-grade bowling machines and practice nets for cricketers of all levels.
          </p>
          
          <div className="bg-slate-900/60 backdrop-blur-md p-6 md:p-8 rounded-2xl border border-white/10 shadow-2xl inline-block w-full max-w-md">
             <h2 className="text-xl md:text-2xl font-bold mb-4 md:mb-6">Start Your Session</h2>
             <div className="flex flex-col gap-3">
                <Link 
                  href="/login" 
                  className="bg-red-600 text-white hover:bg-red-700 px-8 py-3 rounded-xl font-bold text-lg transition-all transform hover:scale-105 shadow-lg"
                >
                  Book Your Slot
                </Link>
                <p className="text-xs md:text-sm text-slate-400">
                  Join ABCA Cricket Today
                </p>
             </div>
          </div>
        </div>

        {/* Features Preview - Compact */}
        <div className="mt-8 md:mt-12 grid grid-cols-3 gap-3 md:gap-4 max-w-4xl mx-auto w-full relative z-10 px-4">
           <div className="bg-white/5 backdrop-blur-sm rounded-xl p-2 md:p-3 border border-white/10 text-center">
             <div className="text-xl md:text-2xl mb-1">🏏</div>
             <h3 className="text-[10px] md:text-sm font-bold">Advanced Machines</h3>
           </div>
           <div className="bg-white/5 backdrop-blur-sm rounded-xl p-2 md:p-3 border border-white/10 text-center">
             <div className="text-xl md:text-2xl mb-1">🏟️</div>
             <h3 className="text-[10px] md:text-sm font-bold">Quality Nets</h3>
           </div>
           <div className="bg-white/5 backdrop-blur-sm rounded-xl p-2 md:p-3 border border-white/10 text-center">
             <div className="text-xl md:text-2xl mb-1">📱</div>
             <h3 className="text-[10px] md:text-sm font-bold">Easy Booking</h3>
           </div>
        </div>

        {/* Simple decorative elements - Hidden on mobile if needed, but kept for flair */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden opacity-5 pointer-events-none z-0">
           <div className="absolute -top-20 -left-20 w-64 h-64 border-8 border-white rounded-full"></div>
           <div className="absolute top-1/2 right-10 w-32 h-32 border-4 border-white rotate-45"></div>
           <div className="absolute bottom-10 left-1/4 w-48 h-48 border-2 border-white rounded-lg"></div>
        </div>
      </section>

      <footer className="py-4 px-4 bg-white border-t text-center text-gray-500 text-[10px] md:text-xs">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row justify-between items-center gap-2">
          <span>© {new Date().getFullYear()} ABCA Cricket Machine Booking. All rights reserved.</span>
          <span className="font-medium text-gray-600">Created by Waheed</span>
        </div>
      </footer>
    </div>
  );
}
