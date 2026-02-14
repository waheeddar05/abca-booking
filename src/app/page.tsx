import Link from "next/link";
import { redirect } from "next/navigation";
import { getToken } from "next-auth/jwt";
import { headers, cookies } from "next/headers";
import { verifyToken } from "@/lib/jwt";
import Image from "next/image";
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
      <section className="relative flex flex-col items-center justify-center px-4 pt-16 pb-10 md:pt-24 md:pb-14 overflow-hidden">
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
      </section>

      {/* Quote Banner 1 */}
      <div className="relative z-10 py-6 bg-gradient-to-r from-accent/5 via-accent/10 to-accent/5 border-y border-accent/10">
        <p className="text-center text-base md:text-lg font-semibold text-accent italic tracking-wide px-4">
          &ldquo;Sweat in Practice. Shine in Matches.&rdquo;
        </p>
      </div>

      {/* Our Machines Section - Huge prominent cards */}
      <section className="relative z-10 px-4 py-12 md:py-16">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-2">Our Bowling Machines</h2>
            <p className="text-sm text-slate-400">Professional-grade equipment for serious practice</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Leather Ball Machine - Hero Card */}
            <div className="group rounded-2xl overflow-hidden border border-white/[0.08] bg-white/[0.03] hover:border-accent/30 transition-all hover:shadow-xl hover:shadow-accent/5">
              <div className="relative w-full aspect-square bg-gradient-to-br from-red-950/50 via-[#1a2235] to-[#132240] flex items-center justify-center overflow-hidden">
                <Image
                  src="/images/leather-ball-machine.svg"
                  alt="Leather Ball Bowling Machine"
                  width={200}
                  height={200}
                  className="w-4/5 h-4/5 drop-shadow-2xl group-hover:scale-105 transition-transform duration-500"
                />
                {/* Glow */}
                <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-red-500/10 to-transparent"></div>
              </div>
              <div className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-full bg-red-500"></span>
                  <h3 className="text-lg font-bold text-white">Leather Ball Machine</h3>
                </div>
                <p className="text-sm text-slate-400">Professional leather ball bowling for match-level practice. Real pace, real swing.</p>
              </div>
            </div>

            {/* Tennis Ball Machine - Hero Card */}
            <div className="group rounded-2xl overflow-hidden border border-white/[0.08] bg-white/[0.03] hover:border-green-500/30 transition-all hover:shadow-xl hover:shadow-green-500/5">
              <div className="relative w-full aspect-square bg-gradient-to-br from-green-950/50 via-[#1a2235] to-[#132240] flex items-center justify-center overflow-hidden">
                <Image
                  src="/images/tennis-ball-machine.svg"
                  alt="Tennis Ball Bowling Machine"
                  width={200}
                  height={200}
                  className="w-4/5 h-4/5 drop-shadow-2xl group-hover:scale-105 transition-transform duration-500"
                />
                {/* Glow */}
                <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-green-500/10 to-transparent"></div>
              </div>
              <div className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-full bg-green-500"></span>
                  <h3 className="text-lg font-bold text-white">Tennis Ball Machine</h3>
                </div>
                <p className="text-sm text-slate-400">Perfect for building technique and timing. Self-operate option available.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quote Banner 2 */}
      <div className="relative z-10 py-5 bg-white/[0.02] border-y border-white/[0.04]">
        <p className="text-center text-sm md:text-base font-medium text-slate-300 italic tracking-wide px-4">
          &ldquo;Champions Aren&apos;t Born. They&apos;re Built &mdash; Ball by Ball.&rdquo;
        </p>
      </div>

      {/* Feature Cards */}
      <section className="relative z-10 px-4 py-12 md:py-16">
        <div className="max-w-2xl mx-auto">
          <div className="grid grid-cols-3 gap-3 md:gap-5">
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
        </div>
      </section>

      {/* Contact Section */}
      <section className="relative z-10 px-4 py-10 bg-white/[0.02] border-t border-white/[0.06]">
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
          {/* Quote */}
          <p className="text-center text-xs text-slate-500 italic">
            &ldquo;Champions Train When Others Rest.&rdquo;
          </p>
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
