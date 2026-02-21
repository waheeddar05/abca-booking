import Link from "next/link";
import { redirect } from "next/navigation";
import { getToken } from "next-auth/jwt";
import { headers, cookies } from "next/headers";
import { verifyToken } from "@/lib/jwt";
import { Calendar, Zap, Clock, ChevronRight, Star, Instagram, Phone, Target, Shield, Users } from "lucide-react";

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
      <section className="relative flex flex-col items-center justify-center px-4 pt-16 pb-12 md:pt-24 md:pb-16 overflow-hidden">
        {/* Background layers */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a1628] via-[#132240] to-[#0d1f3c]"></div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(212,168,67,0.10),transparent_60%)]"></div>

        {/* Cricket Ball SVG - top right */}
        <div className="absolute top-12 right-4 md:right-16 opacity-[0.07] animate-spin-slow pointer-events-none">
          <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="60" cy="60" r="55" stroke="#d4a843" strokeWidth="2" fill="none"/>
            <path d="M25 60 C35 30, 85 30, 95 60" stroke="#d4a843" strokeWidth="1.5" fill="none" strokeDasharray="4 3"/>
            <path d="M25 60 C35 90, 85 90, 95 60" stroke="#d4a843" strokeWidth="1.5" fill="none" strokeDasharray="4 3"/>
          </svg>
        </div>

        {/* Stumps SVG - bottom left */}
        <div className="absolute bottom-4 left-4 md:left-16 opacity-[0.05] pointer-events-none">
          <svg width="80" height="140" viewBox="0 0 80 140" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="15" y="20" width="4" height="120" fill="#d4a843" rx="2"/>
            <rect x="38" y="20" width="4" height="120" fill="#d4a843" rx="2"/>
            <rect x="61" y="20" width="4" height="120" fill="#d4a843" rx="2"/>
            <rect x="10" y="18" width="26" height="4" fill="#d4a843" rx="1"/>
            <rect x="44" y="18" width="26" height="4" fill="#d4a843" rx="1"/>
          </svg>
        </div>

        {/* Pitch crease lines - subtle */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 opacity-[0.04] pointer-events-none">
          <svg width="300" height="60" viewBox="0 0 300 60" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="0" y="0" width="300" height="2" fill="#fff"/>
            <rect x="40" y="20" width="220" height="1" fill="#fff"/>
            <rect x="120" y="40" width="60" height="1" fill="#fff"/>
          </svg>
        </div>

        <div className="relative z-10 max-w-2xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-6 rounded-full bg-accent/10 border border-accent/20 animate-fade-in">
            <Star className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs font-semibold text-accent tracking-wide uppercase">Premium Practice Facility</span>
          </div>

          <h1 className="text-4xl md:text-6xl font-extrabold text-white mb-4 leading-[1.1] tracking-tight animate-fade-in">
            Train Like a
            <span className="block text-accent">Champion</span>
          </h1>

          <p className="text-base md:text-lg text-slate-400 mb-8 max-w-md mx-auto leading-relaxed animate-fade-in delay-100">
            Professional bowling machines and practice nets at Ankeet Bawane Cricket Academy. Book your session and elevate your game.
          </p>

          <Link
            href="/login"
            className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-8 py-3.5 rounded-xl font-bold text-base transition-all hover:shadow-lg hover:shadow-accent/20 active:scale-[0.98] animate-fade-in delay-200"
          >
            Book Your Session
            <ChevronRight className="w-4 h-4" />
          </Link>

          <p className="mt-4 text-xs text-slate-500 animate-fade-in delay-300">
            No subscription required. Pay per session.
          </p>
        </div>
      </section>

      {/* Stats Row */}
      <section className="relative z-10 py-6 bg-gradient-to-r from-accent/5 via-accent/10 to-accent/5 border-y border-accent/10">
        <div className="max-w-3xl mx-auto px-4">
          <div className="grid grid-cols-4 gap-3 text-center">
            <div>
              <p className="text-xl md:text-2xl font-extrabold text-accent">4</p>
              <p className="text-[10px] md:text-xs text-slate-400 mt-0.5">Pro Machines</p>
            </div>
            <div>
              <p className="text-xl md:text-2xl font-extrabold text-accent">3</p>
              <p className="text-[10px] md:text-xs text-slate-400 mt-0.5">Pitch Types</p>
            </div>
            <div>
              <p className="text-xl md:text-2xl font-extrabold text-accent">30</p>
              <p className="text-[10px] md:text-xs text-slate-400 mt-0.5">Min Sessions</p>
            </div>
            <div>
              <p className="text-xl md:text-2xl font-extrabold text-accent">7+</p>
              <p className="text-[10px] md:text-xs text-slate-400 mt-0.5">Years Exp</p>
            </div>
          </div>
        </div>
      </section>

      {/* Our Machines Section - All 4 machines */}
      <section className="relative z-10 px-4 py-12 md:py-16">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-2">Our Bowling Machines</h2>
            <p className="text-sm text-slate-400">Professional-grade equipment for serious practice</p>
          </div>

          {/* Leather Machines Row */}
          <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>
            Leather Ball Machines
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {/* Gravity */}
            <div className="group rounded-2xl overflow-hidden border border-white/[0.08] bg-white/[0.03] hover:border-red-500/30 transition-all hover:shadow-xl hover:shadow-red-500/5">
              <div className="relative w-full aspect-[4/3] bg-gradient-to-br from-red-950/40 via-[#1a2235] to-[#132240] overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/leathermachine.jpeg"
                  alt="Gravity Bowling Machine"
                  className="w-full h-full object-contain p-[8%] drop-shadow-2xl group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-red-500/20 border border-red-500/30">
                  <span className="text-[10px] font-bold text-red-400">LEATHER</span>
                </div>
              </div>
              <div className="p-4">
                <h3 className="text-base font-bold text-white mb-1">Gravity</h3>
                <p className="text-xs text-slate-400 leading-relaxed">Professional leather ball bowling machine. Real pace, real swing for match-level practice.</p>
                <div className="flex gap-2 mt-2.5">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400 border border-white/[0.08]">Astro</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400 border border-white/[0.08]">Cement</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400 border border-white/[0.08]">Natural</span>
                </div>
              </div>
            </div>

            {/* Yantra */}
            <div className="group rounded-2xl overflow-hidden border border-white/[0.08] bg-white/[0.03] hover:border-amber-500/30 transition-all hover:shadow-xl hover:shadow-amber-500/5">
              <div className="relative w-full aspect-[4/3] bg-gradient-to-br from-amber-950/40 via-[#1a2235] to-[#132240] overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/yantra-machine.jpeg"
                  alt="Yantra Premium Bowling Machine"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-amber-500/20 border border-amber-500/30">
                  <span className="text-[10px] font-bold text-amber-400">PREMIUM</span>
                </div>
              </div>
              <div className="p-4">
                <h3 className="text-base font-bold text-white mb-1">Yantra <span className="text-xs font-normal text-amber-400">(Premium)</span></h3>
                <p className="text-xs text-slate-400 leading-relaxed">Premium leather ball experience with advanced speed control and variable swing settings.</p>
                <div className="flex gap-2 mt-2.5">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400 border border-white/[0.08]">Astro</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400 border border-white/[0.08]">Cement</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400 border border-white/[0.08]">Natural</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tennis Machines Row */}
          <p className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
            Tennis Ball Machines
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Leverage Indoor */}
            <div className="group rounded-2xl overflow-hidden border border-white/[0.08] bg-white/[0.03] hover:border-green-500/30 transition-all hover:shadow-xl hover:shadow-green-500/5">
              <div className="relative w-full aspect-[4/3] bg-gradient-to-br from-green-950/40 via-[#1a2235] to-[#132240] overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/tennismachine.jpeg"
                  alt="Leverage Indoor Tennis Ball Machine"
                  className="w-full h-full object-contain p-[8%] drop-shadow-2xl group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-green-500/20 border border-green-500/30">
                  <span className="text-[10px] font-bold text-green-400">INDOOR</span>
                </div>
              </div>
              <div className="p-4">
                <h3 className="text-base font-bold text-white mb-1">Leverage High Speed <span className="text-xs font-normal text-green-400">(Indoor)</span></h3>
                <p className="text-xs text-slate-400 leading-relaxed">High-speed tennis ball machine in an enclosed indoor setup. Great for technique building.</p>
                <div className="flex gap-2 mt-2.5">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400 border border-white/[0.08]">Astro</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400 border border-white/[0.08]">Cement</span>
                </div>
              </div>
            </div>

            {/* Leverage Outdoor */}
            <div className="group rounded-2xl overflow-hidden border border-white/[0.08] bg-white/[0.03] hover:border-emerald-500/30 transition-all hover:shadow-xl hover:shadow-emerald-500/5">
              <div className="relative w-full aspect-[4/3] bg-gradient-to-br from-emerald-950/40 via-[#1a2235] to-[#132240] overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/tennismachine.jpeg"
                  alt="Leverage Outdoor Tennis Ball Machine"
                  className="w-full h-full object-contain p-[8%] drop-shadow-2xl group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-emerald-500/20 border border-emerald-500/30">
                  <span className="text-[10px] font-bold text-emerald-400">OUTDOOR</span>
                </div>
              </div>
              <div className="p-4">
                <h3 className="text-base font-bold text-white mb-1">Leverage High Speed <span className="text-xs font-normal text-emerald-400">(Outdoor)</span></h3>
                <p className="text-xs text-slate-400 leading-relaxed">Open-air high-speed tennis ball machine. Perfect for batting in natural conditions.</p>
                <div className="flex gap-2 mt-2.5">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400 border border-white/[0.08]">Astro</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400 border border-white/[0.08]">Cement</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Cards */}
      <section className="relative z-10 px-4 py-12 md:py-16 bg-white/[0.02] border-y border-white/[0.06]">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-xl md:text-2xl font-extrabold text-white mb-2">Why Practice With Us</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-5">
            <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl p-4 md:p-5 border border-white/[0.06] text-center group hover:bg-white/[0.07] transition-all">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-2.5">
                <Zap className="w-5 h-5 md:w-6 md:h-6 text-accent" />
              </div>
              <h3 className="text-xs md:text-sm font-semibold text-white">4 Pro Machines</h3>
              <p className="text-[10px] md:text-xs text-slate-500 mt-1">Leather & Tennis ball</p>
            </div>
            <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl p-4 md:p-5 border border-white/[0.06] text-center group hover:bg-white/[0.07] transition-all">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-2.5">
                <Target className="w-5 h-5 md:w-6 md:h-6 text-accent" />
              </div>
              <h3 className="text-xs md:text-sm font-semibold text-white">Multiple Pitches</h3>
              <p className="text-[10px] md:text-xs text-slate-500 mt-1">Astro, Cement, Natural</p>
            </div>
            <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl p-4 md:p-5 border border-white/[0.06] text-center group hover:bg-white/[0.07] transition-all">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-2.5">
                <Calendar className="w-5 h-5 md:w-6 md:h-6 text-accent" />
              </div>
              <h3 className="text-xs md:text-sm font-semibold text-white">Easy Booking</h3>
              <p className="text-[10px] md:text-xs text-slate-500 mt-1">Book in 30 seconds</p>
            </div>
            <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl p-4 md:p-5 border border-white/[0.06] text-center group hover:bg-white/[0.07] transition-all">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-2.5">
                <Clock className="w-5 h-5 md:w-6 md:h-6 text-accent" />
              </div>
              <h3 className="text-xs md:text-sm font-semibold text-white">Flexible Slots</h3>
              <p className="text-[10px] md:text-xs text-slate-500 mt-1">Morning & Evening</p>
            </div>
            <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl p-4 md:p-5 border border-white/[0.06] text-center group hover:bg-white/[0.07] transition-all">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-2.5">
                <Shield className="w-5 h-5 md:w-6 md:h-6 text-accent" />
              </div>
              <h3 className="text-xs md:text-sm font-semibold text-white">Safe & Secure</h3>
              <p className="text-[10px] md:text-xs text-slate-500 mt-1">Pro-grade safety nets</p>
            </div>
            <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl p-4 md:p-5 border border-white/[0.06] text-center group hover:bg-white/[0.07] transition-all">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-2.5">
                <Users className="w-5 h-5 md:w-6 md:h-6 text-accent" />
              </div>
              <h3 className="text-xs md:text-sm font-semibold text-white">Expert Coaching</h3>
              <p className="text-[10px] md:text-xs text-slate-500 mt-1">Available on request</p>
            </div>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section className="relative z-10 px-4 py-10">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-lg font-bold text-white mb-1">Get In Touch</h2>
          <p className="text-xs text-slate-400 mb-5">Book your session or ask us anything</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="tel:7058683664" className="flex items-center gap-2 px-5 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:border-accent/30 transition-all text-sm text-slate-300 hover:text-accent">
              <Phone className="w-4 h-4" />
              <span><span className="font-semibold">Pratyush:</span> 7058683664</span>
            </a>
            <a href="tel:7774077995" className="flex items-center gap-2 px-5 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:border-accent/30 transition-all text-sm text-slate-300 hover:text-accent">
              <Phone className="w-4 h-4" />
              <span><span className="font-semibold">Rahul:</span> 7774077995</span>
            </a>
            <a
              href="https://www.instagram.com/ankeetbawanecricketacademy?igsh=MWFvd2p0MzlrOWQ1Mg%3D%3D"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:border-accent/30 transition-all text-sm text-slate-300 hover:text-accent"
            >
              <Instagram className="w-4 h-4" />
              @ankeetbawanecricketacademy
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 py-6 px-4 border-t border-white/[0.06]">
        <div className="max-w-2xl mx-auto space-y-3">
          <p className="text-center text-xs text-slate-500 italic">
            &ldquo;Champions Train When Others Rest.&rdquo;
          </p>
          <div className="flex flex-col md:flex-row justify-between items-center gap-2 text-center">
            <span className="text-[11px] text-slate-600">&copy; {new Date().getFullYear()} Ankeet Bawane Cricket Academy. All rights reserved.</span>
            <span className="text-[11px] text-slate-600">Made by Waheed</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
