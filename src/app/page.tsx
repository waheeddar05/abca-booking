import Link from "next/link";
import { redirect } from "next/navigation";
import { getToken } from "next-auth/jwt";
import { headers, cookies } from "next/headers";
import { verifyToken } from "@/lib/jwt";
import { Calendar, Zap, Clock, ChevronRight, Star, Instagram, Phone } from "lucide-react";

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
    redirect("/slots");
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#0a1628]">
      {/* Hero Section */}
      <section className="relative flex-1 flex flex-col items-center justify-center px-4 py-16 md:py-0 overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a1628] via-[#132240] to-[#0d1f3c]"></div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(212,168,67,0.08),transparent_60%)]"></div>

        {/* Subtle cricket seam pattern */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 0 L30 60' stroke='%23fff' stroke-width='0.5' fill='none'/%3E%3Cpath d='M0 30 L60 30' stroke='%23fff' stroke-width='0.5' fill='none'/%3E%3C/svg%3E")`,
        }}></div>

        <div className="relative z-10 max-w-2xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-6 rounded-full bg-accent/10 border border-accent/20">
            <Star className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs font-semibold text-accent tracking-wide uppercase">Premium Practice Facility</span>
          </div>

          <h1 className="text-4xl md:text-6xl font-extrabold text-white mb-4 leading-[1.1] tracking-tight">
            Train Like a
            <span className="block text-accent">Champion</span>
          </h1>

          <p className="text-base md:text-lg text-slate-400 mb-8 max-w-md mx-auto leading-relaxed">
            Professional bowling machines and practice nets. Book your session and elevate your cricket game.
          </p>

          <Link
            href="/login"
            className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-8 py-3.5 rounded-xl font-bold text-base transition-all hover:shadow-lg hover:shadow-accent/20 active:scale-[0.98]"
          >
            Book Your Session
            <ChevronRight className="w-4 h-4" />
          </Link>

          <p className="mt-4 text-xs text-slate-500">
            No subscription required. Pay per session.
          </p>
        </div>

        {/* Feature Cards */}
        <div className="relative z-10 mt-12 md:mt-16 grid grid-cols-3 gap-3 md:gap-5 max-w-lg md:max-w-2xl mx-auto w-full px-4">
          <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl p-4 md:p-5 border border-white/[0.06] text-center group hover:bg-white/[0.07] transition-all">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-2.5">
              <Zap className="w-5 h-5 md:w-6 md:h-6 text-accent" />
            </div>
            <h3 className="text-xs md:text-sm font-semibold text-white">Pro Machines</h3>
            <p className="text-[10px] md:text-xs text-slate-500 mt-1 hidden md:block">Advanced bowling tech</p>
          </div>
          <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl p-4 md:p-5 border border-white/[0.06] text-center group hover:bg-white/[0.07] transition-all">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-2.5">
              <Calendar className="w-5 h-5 md:w-6 md:h-6 text-accent" />
            </div>
            <h3 className="text-xs md:text-sm font-semibold text-white">Easy Booking</h3>
            <p className="text-[10px] md:text-xs text-slate-500 mt-1 hidden md:block">Book in 30 seconds</p>
          </div>
          <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl p-4 md:p-5 border border-white/[0.06] text-center group hover:bg-white/[0.07] transition-all">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-2.5">
              <Clock className="w-5 h-5 md:w-6 md:h-6 text-accent" />
            </div>
            <h3 className="text-xs md:text-sm font-semibold text-white">Flexible Slots</h3>
            <p className="text-[10px] md:text-xs text-slate-500 mt-1 hidden md:block">30-min sessions</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 py-6 px-4 border-t border-white/[0.06]">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Contact & Social */}
          <div className="flex flex-col md:flex-row items-center justify-center gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-4">
              <a href="tel:7058683664" className="flex items-center gap-1.5 hover:text-accent transition-colors">
                <Phone className="w-3.5 h-3.5" />
                Pratyush: 7058683664
              </a>
              <a href="tel:7774077995" className="flex items-center gap-1.5 hover:text-accent transition-colors">
                <Phone className="w-3.5 h-3.5" />
                Rahul: 7774077995
              </a>
            </div>
            <a
              href="https://www.instagram.com/ankeetbawanecricketacademy?igsh=MWFvd2p0MzlrOWQ1Mg%3D%3D"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-accent transition-colors"
            >
              <Instagram className="w-3.5 h-3.5" />
              @ankeetbawanecricketacademy
            </a>
          </div>
          {/* Copyright */}
          <div className="flex flex-col md:flex-row justify-between items-center gap-2 text-center">
            <span className="text-[11px] text-slate-600">&copy; {new Date().getFullYear()} Ankeet Bawane Cricket Academy. All rights reserved.</span>
            <span className="text-[11px] text-slate-600">Made by Waheed</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
