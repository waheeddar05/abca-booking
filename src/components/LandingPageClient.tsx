'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { Calendar, Zap, Clock, Instagram, Phone, Target, Shield, Users, Star, ArrowRight, MapPin } from 'lucide-react';
import LoginModal from './LoginModal';
import { CONTACT_NUMBERS, INSTAGRAM_URL, LOCATION_URL } from '@/lib/client-constants';

export default function LandingPageClient() {
  const [loginOpen, setLoginOpen] = useState(false);

  const openLogin = () => setLoginOpen(true);
  const closeLogin = () => setLoginOpen(false);

  return (
    <div className="flex flex-col min-h-screen bg-[#030712] text-slate-200 selection:bg-accent/30 selection:text-white">
      {/* Background Decor */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-20%] left-[-15%] w-[50%] h-[50%] bg-accent/8 rounded-full blur-[150px] animate-pulse-soft"></div>
        <div className="absolute bottom-[-15%] right-[-10%] w-[45%] h-[45%] bg-purple-500/6 rounded-full blur-[140px] animate-pulse-soft delay-1000"></div>
        <div className="absolute top-[40%] left-[50%] -translate-x-1/2 w-[30%] h-[30%] bg-cyan-500/4 rounded-full blur-[120px]"></div>
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass-dark border-b border-white/5 px-4 md:px-6 py-1.5 md:py-2">
        <div className="max-w-7xl mx-auto flex justify-between items-center h-10 md:h-10">
          <div className="flex items-center gap-1.5 md:gap-2">
            <Image
              src="/images/playorbit-logo.png"
              alt="PlayOrbit"
              width={320}
              height={213}
              className="h-10 md:h-24 w-auto object-contain"
              priority
              sizes="(max-width: 768px) 60px, 120px"
            />
          </div>
          <button
            onClick={openLogin}
            className="text-xs md:text-sm font-bold bg-white/5 hover:bg-white/10 text-white px-4 md:px-5 py-2 md:py-2 rounded-full border border-white/10 transition-all active:scale-95 flex-shrink-0 cursor-pointer"
          >
            Login
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 flex flex-col items-center justify-center px-4 pt-16 pb-2 md:pt-16 md:pb-8 overflow-hidden text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-1.5 md:gap-2 px-2.5 md:px-3 py-1 md:py-1.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-[10px] md:text-[10px] font-bold uppercase tracking-[0.15em] md:tracking-[0.2em] mb-3 md:mb-4 animate-fade-in">
            <Star className="w-2.5 h-2.5 md:w-3 md:h-3 fill-current" />
            Leading Cricket Tech In Pune
            <Star className="w-2.5 h-2.5 md:w-3 md:h-3 fill-current" />
          </div>

          <div className="relative mb-1 md:mb-4 animate-fade-in delay-100">
            <Image
              src="/images/playorbit-logo.png"
              alt="PlayOrbit"
              width={320}
              height={213}
              className="w-[90vw] md:w-auto h-auto md:h-[88px] object-contain mx-auto drop-shadow-[0_0_25px_rgba(56,189,248,0.4)]"
              priority
              sizes="(max-width: 768px) 90vw, 200px"
            />
          </div>

          <h1 className="text-xl md:text-4xl font-black text-white mb-1 md:mb-3 leading-[1.1] tracking-tight animate-fade-in delay-200">
            TRAIN LIKE A <br className="sm:hidden" />
            <span className="text-shimmer drop-shadow-[0_0_15px_rgba(56,189,248,0.3)]">CHAMPION.</span>
          </h1>

          <p className="text-xs md:text-base text-slate-400 mb-3 md:mb-5 max-w-2xl mx-auto leading-relaxed animate-fade-in delay-300 px-2 md:px-0">
            Next-Gen Practice. Pro Bowling Machines. Expertly Maintained Nets.
          </p>

          <div className="flex flex-row items-center justify-center gap-2 md:gap-3 animate-fade-in delay-400">
            <button
              onClick={openLogin}
              className="inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-light text-primary px-6 py-2.5 md:px-7 md:py-3 rounded-xl md:rounded-xl font-black text-xs md:text-sm transition-all hover:shadow-[0_0_40px_rgba(56,189,248,0.4)] active:scale-[0.98] cursor-pointer"
            >
              BOOK SESSION
              <ArrowRight className="w-3.5 h-3.5 md:w-4 md:h-4" />
            </button>
            <a
              href="#machines"
              className="inline-flex items-center justify-center gap-2 glass hover:bg-white/5 text-white px-6 py-2.5 md:px-7 md:py-3 rounded-xl md:rounded-xl font-black text-xs md:text-sm transition-all border border-white/10 active:scale-[0.98]"
            >
              VIEW MACHINES
            </a>
          </div>

          <div className="flex mt-3 md:mt-4 flex-wrap items-center justify-center gap-2 md:gap-4 text-slate-500 text-[10px] md:text-xs font-medium uppercase tracking-wider md:tracking-widest leading-none animate-fade-in delay-500">
            <span className="flex items-center gap-1"><Shield className="w-3 h-3 md:w-3.5 md:h-3.5" /> Secure Booking</span>
            <span className="text-white/10">&middot;</span>
            <span className="flex items-center gap-1"><Target className="w-3 h-3 md:w-3.5 md:h-3.5" /> High Precision</span>
            <span className="text-white/10">&middot;</span>
            <span className="flex items-center gap-1"><Zap className="w-3 h-3 md:w-3.5 md:h-3.5" /> Instant Access</span>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="relative z-10 py-2 md:py-5 border-y border-white/5 glass-dark overflow-hidden">
        <div className="absolute inset-0 bg-accent/5 opacity-50 blur-3xl -z-10"></div>
        <div className="max-w-6xl mx-auto px-4 md:px-6">
          <div className="grid grid-cols-4 gap-x-2 md:gap-8">
            {[
              { label: 'Machines', value: '04', icon: Zap },
              { label: 'Pitches', value: '03', icon: Target },
              { label: 'Players', value: '500+', icon: Users },
              { label: 'Hours', value: '2K+', icon: Clock },
            ].map((stat, i) => (
              <div key={i} className="text-center group">
                <stat.icon className="w-3 h-3 md:w-4 md:h-4 mx-auto mb-0.5 md:mb-1.5 text-accent/60 group-hover:text-accent transition-colors" />
                <p className="text-lg md:text-2xl font-black text-white mb-0 md:mb-0.5 tabular-nums">{stat.value}</p>
                <p className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Machines Section */}
      <section id="machines" className="relative z-10 px-4 md:px-6 py-4 md:py-12">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 lg:grid-cols-2 gap-2.5 md:gap-5">
            {/* Machine Card 1: Gravity */}
            <div className="group relative rounded-xl md:rounded-2xl overflow-hidden border border-white/[0.06] hover:border-accent/20 transition-all duration-500 bg-[#060d1b]/80 hover:shadow-[0_8px_40px_rgba(56,189,248,0.08)]">
              <div className="relative aspect-[4/3] bg-[#050b14] overflow-hidden">
                <Image
                  src="/images/leathermachine.jpeg"
                  alt="Gravity bowling machine"
                  fill
                  className="object-cover object-center group-hover:scale-105 transition-transform duration-700 opacity-85 group-hover:opacity-100"
                  loading="lazy"
                  sizes="(max-width: 768px) 50vw, 600px"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#030712]/90 via-[#030712]/20 to-transparent"></div>
                <div className="absolute bottom-1.5 left-1.5 md:bottom-3 md:left-3">
                  <h4 className="text-[11px] md:text-lg font-black text-accent uppercase italic leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">Gravity</h4>
                </div>
                <div className="absolute bottom-1.5 right-1.5 md:bottom-3 md:right-3">
                  <span className="px-1.5 py-0.5 md:px-2 md:py-0.5 rounded-full bg-black/40 backdrop-blur-md border border-red-500/25 text-red-400 text-[7px] md:text-[10px] font-bold uppercase tracking-wider">Leather</span>
                </div>
              </div>
              <div className="px-1.5 py-1.5 md:px-3 md:py-2.5">
                <div className="flex flex-wrap justify-center gap-0.5 md:gap-1.5">
                  {['Astro Turf', 'Cement', 'Natural Turf'].map(tag => (
                    <span key={tag} className="text-[7px] md:text-[10px] font-semibold px-1.5 py-0.5 md:px-2 md:py-0.5 rounded-full bg-white/[0.04] text-slate-500 border border-white/[0.06] uppercase tracking-wider">{tag}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Machine Card 2: Yantra */}
            <div className="group relative rounded-xl md:rounded-2xl overflow-hidden border border-white/[0.06] hover:border-accent/20 transition-all duration-500 bg-[#060d1b]/80 hover:shadow-[0_8px_40px_rgba(56,189,248,0.08)]">
              <div className="relative aspect-[4/3] bg-[#050b14] overflow-hidden">
                <Image
                  src="/images/yantra-machine.jpeg"
                  alt="Yantra bowling machine"
                  fill
                  className="object-cover object-[center_40%] group-hover:scale-105 transition-transform duration-700 opacity-85 group-hover:opacity-100"
                  loading="lazy"
                  sizes="(max-width: 768px) 50vw, 600px"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#030712]/90 via-[#030712]/20 to-transparent"></div>
                <div className="absolute bottom-1.5 left-1.5 md:bottom-3 md:left-3">
                  <h4 className="text-[11px] md:text-lg font-black text-accent uppercase italic leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">Yantra</h4>
                </div>
                <div className="absolute bottom-1.5 right-1.5 md:bottom-3 md:right-3">
                  <span className="px-1.5 py-0.5 md:px-2 md:py-0.5 rounded-full bg-black/40 backdrop-blur-md border border-amber-500/25 text-amber-400 text-[7px] md:text-[10px] font-bold uppercase tracking-wider">Premium Leather</span>
                </div>
              </div>
              <div className="px-1.5 py-1.5 md:px-3 md:py-2.5">
                <div className="flex flex-wrap justify-center gap-0.5 md:gap-1.5">
                  {['Astro Turf', 'Cement', 'Natural Turf'].map(tag => (
                    <span key={tag} className="text-[7px] md:text-[10px] font-semibold px-1.5 py-0.5 md:px-2 md:py-0.5 rounded-full bg-white/[0.04] text-slate-500 border border-white/[0.06] uppercase tracking-wider">{tag}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Machine Card 3: Leverage Indoor */}
            <div className="group relative rounded-xl md:rounded-2xl overflow-hidden border border-white/[0.06] hover:border-accent/20 transition-all duration-500 bg-[#060d1b]/80 hover:shadow-[0_8px_40px_rgba(56,189,248,0.08)]">
              <div className="relative aspect-[4/3] bg-[#050b14] overflow-hidden">
                <Image
                  src="/images/tennismachine.jpeg"
                  alt="Leverage indoor tennis machine"
                  fill
                  className="object-cover object-[center_25%] group-hover:scale-105 transition-transform duration-700 opacity-85 group-hover:opacity-100"
                  loading="lazy"
                  sizes="(max-width: 768px) 50vw, 600px"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#030712]/90 via-[#030712]/20 to-transparent"></div>
                <div className="absolute bottom-1.5 left-1.5 md:bottom-3 md:left-3">
                  <h4 className="text-[9px] md:text-base font-black text-accent uppercase italic leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">Leverage Tennis</h4>
                </div>
                <div className="absolute bottom-1.5 right-1.5 md:bottom-3 md:right-3">
                  <span className="px-1.5 py-0.5 md:px-2 md:py-0.5 rounded-full bg-black/40 backdrop-blur-md border border-green-500/25 text-green-400 text-[7px] md:text-[10px] font-bold uppercase tracking-wider">Indoor</span>
                </div>
              </div>
              <div className="px-1.5 py-1.5 md:px-3 md:py-2.5">
                <div className="flex flex-wrap justify-center gap-0.5 md:gap-1.5">
                  {['Astro Turf', 'Cement', 'Natural Turf'].map(tag => (
                    <span key={tag} className="text-[7px] md:text-[10px] font-semibold px-1.5 py-0.5 md:px-2 md:py-0.5 rounded-full bg-white/[0.04] text-slate-500 border border-white/[0.06] uppercase tracking-wider">{tag}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Machine Card 4: Leverage Outdoor */}
            <div className="group relative rounded-xl md:rounded-2xl overflow-hidden border border-white/[0.06] hover:border-accent/20 transition-all duration-500 bg-[#060d1b]/80 hover:shadow-[0_8px_40px_rgba(56,189,248,0.08)]">
              <div className="relative aspect-[4/3] bg-[#050b14] overflow-hidden">
                <Image
                  src="/images/tennismachine.jpeg"
                  alt="Leverage outdoor tennis machine"
                  fill
                  className="object-cover object-[center_25%] group-hover:scale-105 transition-transform duration-700 opacity-85 group-hover:opacity-100"
                  loading="lazy"
                  sizes="(max-width: 768px) 50vw, 600px"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#030712]/90 via-[#030712]/20 to-transparent"></div>
                <div className="absolute bottom-1.5 left-1.5 md:bottom-3 md:left-3">
                  <h4 className="text-[9px] md:text-base font-black text-accent uppercase italic leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">Leverage Tennis</h4>
                </div>
                <div className="absolute bottom-1.5 right-1.5 md:bottom-3 md:right-3">
                  <span className="px-1.5 py-0.5 md:px-2 md:py-0.5 rounded-full bg-black/40 backdrop-blur-md border border-emerald-500/25 text-emerald-400 text-[7px] md:text-[10px] font-bold uppercase tracking-wider">Outdoor</span>
                </div>
              </div>
              <div className="px-1.5 py-1.5 md:px-3 md:py-2.5">
                <div className="flex flex-wrap justify-center gap-0.5 md:gap-1.5">
                  {['Astro Turf', 'Cement', 'Natural Turf'].map(tag => (
                    <span key={tag} className="text-[7px] md:text-[10px] font-semibold px-1.5 py-0.5 md:px-2 md:py-0.5 rounded-full bg-white/[0.04] text-slate-500 border border-white/[0.06] uppercase tracking-wider">{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="relative z-10 px-4 md:px-6 py-4 md:py-10 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-accent/[0.02] to-transparent -z-10"></div>
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-3 md:mb-8">
            <h3 className="text-lg md:text-3xl font-black text-white mb-1 md:mb-3 leading-tight">THE PLAYORBIT <span className="text-accent/40">ADVANTAGE.</span></h3>
          </div>

          <div className="grid grid-cols-3 lg:grid-cols-3 gap-1.5 md:gap-4">
            {[
              { title: 'Pro Machines', desc: 'Leather & Tennis ball options', icon: Zap, color: 'text-accent' },
              { title: 'Triple Pitch', desc: 'Astro, Cement & Natural', icon: Target, color: 'text-purple-400' },
              { title: '1-Click Book', desc: 'Zero friction booking flow', icon: Calendar, color: 'text-emerald-400' },
              { title: 'Anytime', desc: 'Morning to late evening', icon: Clock, color: 'text-amber-400' },
              { title: 'Safety First', desc: 'Pro-grade enclosure nets', icon: Shield, color: 'text-red-400' },
              { title: 'Coaching', desc: 'Available for sessions', icon: Users, color: 'text-cyan-400' },
            ].map((feature, i) => {
              const Icon = feature.icon;
              return (
                <div key={i} className="group p-2 md:p-5 rounded-lg md:rounded-2xl border border-white/[0.05] hover:border-white/[0.1] bg-[#060d1b]/60 hover:bg-[#0a1628]/80 transition-all duration-300 text-center md:text-left">
                  <div className={`w-7 h-7 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-white/[0.04] flex items-center justify-center mb-1.5 md:mb-3 border border-white/[0.06] mx-auto md:mx-0 ${feature.color} group-hover:scale-110 transition-transform`}>
                    <Icon className="w-3.5 h-3.5 md:w-5 md:h-5" />
                  </div>
                  <h4 className="text-xs md:text-base font-black text-white mb-0.5 md:mb-1.5 uppercase italic tracking-tighter leading-tight">{feature.title}</h4>
                  <p className="text-slate-500 text-[10px] md:text-xs leading-relaxed group-hover:text-slate-400 transition-colors">{feature.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section className="relative z-10 px-4 md:px-6 py-4 md:py-12 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] md:w-[500px] h-[300px] md:h-[500px] bg-accent/6 rounded-full blur-[100px] md:blur-[140px] -z-10"></div>
        <div className="max-w-4xl mx-auto rounded-xl md:rounded-2xl p-3 md:p-8 text-center border border-white/[0.08] bg-[#060d1b]/70 backdrop-blur-xl overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.03] via-transparent to-purple-500/[0.02] -z-10"></div>
          <h2 className="text-lg md:text-3xl font-black text-white mb-0.5 md:mb-2">READY TO PLAY?</h2>
          <p className="text-slate-500 text-[10px] md:text-sm mb-3 md:mb-6 max-w-xl mx-auto leading-relaxed">Reach out via phone or Social Media.</p>

          <div className="grid grid-cols-4 gap-1.5 md:flex md:flex-row md:items-start md:justify-center md:gap-8 w-full">
            {CONTACT_NUMBERS.map((contact, idx) => (
              <React.Fragment key={contact.number}>
                {idx > 0 && <div className="hidden md:block w-px h-16 bg-white/[0.06]"></div>}
                <a href={`tel:${contact.number}`} className="flex flex-col items-center gap-0.5 md:gap-1.5 group active:scale-95 transition-transform min-w-0">
                  <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl md:rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center group-hover:bg-accent group-hover:text-primary group-hover:border-accent/40 transition-all group-hover:shadow-[0_0_24px_rgba(56,189,248,0.25)] mb-0.5 md:mb-1 flex-shrink-0">
                    <Phone className="w-3.5 h-3.5 md:w-5 md:h-5" />
                  </div>
                  <span className="text-[8px] md:text-[11px] uppercase font-bold tracking-wider text-slate-600 truncate w-full">{contact.name}</span>
                  <span className="text-white font-bold text-[9px] md:text-sm truncate w-full tabular-nums">{contact.number}</span>
                </a>
              </React.Fragment>
            ))}
            <div className="hidden md:block w-px h-16 bg-white/[0.06]"></div>
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-0.5 md:gap-1.5 group active:scale-95 transition-transform min-w-0"
            >
              <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl md:rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center group-hover:bg-[#E1306C] group-hover:text-white group-hover:border-[#E1306C]/40 transition-all group-hover:shadow-[0_0_24px_rgba(225,48,108,0.3)] mb-0.5 md:mb-1 flex-shrink-0">
                <Instagram className="w-3.5 h-3.5 md:w-5 md:h-5" />
              </div>
              <span className="text-[8px] md:text-[11px] uppercase font-bold tracking-wider text-slate-600 truncate w-full">Instagram</span>
              <span className="text-white font-bold text-[9px] md:text-sm truncate w-full">@playorbit.in</span>
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 py-3 md:py-5 px-4 md:px-6 border-t border-white/[0.05] bg-[#020509]/80">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-3 md:gap-4">
          <div className="flex items-center gap-2">
            <Image
              src="/images/playorbit-logo.png"
              alt="PlayOrbit"
              width={160}
              height={107}
              className="h-12 md:h-24 w-auto object-contain opacity-70"
              loading="lazy"
              sizes="(max-width: 768px) 60px, 120px"
            />
          </div>

          <div className="flex items-center gap-6 md:gap-6">
            <button onClick={openLogin} className="text-xs md:text-sm font-bold uppercase tracking-wider text-slate-500 hover:text-accent transition-colors py-3 min-h-[44px] flex items-center cursor-pointer">Book Now</button>
            <button onClick={openLogin} className="text-xs md:text-sm font-bold uppercase tracking-wider text-slate-500 hover:text-accent transition-colors py-3 min-h-[44px] flex items-center cursor-pointer">Admin</button>
            <a href="#" className="text-xs md:text-sm font-bold uppercase tracking-wider text-slate-500 hover:text-accent transition-colors py-3 min-h-[44px] flex items-center">Support</a>
          </div>

          <div className="text-center md:text-right">
            <p className="text-[10px] md:text-xs font-black uppercase tracking-[0.2em] text-slate-700 leading-none">&copy; {new Date().getFullYear()} PlayOrbit. Designed for Champions.</p>
          </div>
        </div>
        <div className="mt-2 md:mt-4 text-center">
          <p className="text-xs font-bold text-slate-800 uppercase tracking-[0.3em]">Built with Excellence by Waheed</p>
        </div>
      </footer>

      {/* Login Modal */}
      <LoginModal isOpen={loginOpen} onClose={closeLogin} />
    </div>
  );
}
