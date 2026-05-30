'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Building2, MapPin, Phone, Mail, Check, Loader2, Navigation, ArrowRight } from 'lucide-react';
import { useCenter, type PublicCenter } from '@/lib/center-context';
import { ContactFooter } from '@/components/ContactFooter';

// Haversine distance, km. Inlined here so this file can stay a client
// component without dragging in `next/headers`-using server modules.
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * /centers — public listing of every active PlayOrbit center.
 *
 * - Anyone can browse it, even unauthenticated visitors.
 * - "Use my location" button computes Haversine distance to each center
 *   and sorts ascending (browser geolocation, requires permission).
 * - Tapping a center calls /api/centers/select and redirects to /slots
 *   (or back to the URL the user came from via `?next=/foo`).
 */

export default function CentersPage() {
  // useSearchParams() forces client-side bailout from prerender — Next.js
  // requires the consumer to be inside a Suspense boundary so SSG can emit
  // a fallback shell.
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      }
    >
      <CentersPageInner />
    </Suspense>
  );
}

function CentersPageInner() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get('next') || '/slots';
  const { centers, currentCenterId, switchTo, loading } = useCenter();
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<'idle' | 'requesting' | 'denied' | 'unsupported'>('idle');
  const [switching, setSwitching] = useState<string | null>(null);

  // Geolocation is requested only when the user clicks the button — auto-
  // prompting on load gets throttled by browsers and is annoying. The
  // "unsupported" state is detected lazily, the same way.
  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setGeoStatus('unsupported');
      return;
    }
    setGeoStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setGeoStatus('idle');
      },
      () => setGeoStatus('denied'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  };

  const sortedCenters = sortCenters(centers, coords);

  const handleSelect = async (centerId: string) => {
    setSwitching(centerId);
    const ok = await switchTo(centerId);
    if (!ok) {
      setSwitching(null);
      return;
    }
    // switchTo() does a full reload. If it returns first (rare), navigate manually.
    router.push(next);
  };

  return (
    <div className="min-h-[calc(100vh-56px)] overflow-x-hidden">
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-[#0a1628] via-[#0f1d35] to-[#0d1f3c]"></div>

      <main className="max-w-3xl mx-auto px-4 py-6 md:py-10">
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">Choose your center</h1>
              <p className="text-xs text-slate-400">Slots, pricing and packages are specific to each center.</p>
            </div>
          </div>

          {centers.length >= 2 && (
            <div className="mt-3">
              {coords ? (
                <div className="text-[11px] text-emerald-400 flex items-center gap-1.5">
                  <Navigation className="w-3 h-3" />
                  Sorted by distance from your location
                </div>
              ) : (
                <button
                  onClick={useMyLocation}
                  disabled={geoStatus === 'requesting'}
                  className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-slate-300 hover:bg-white/[0.06] hover:text-white cursor-pointer disabled:opacity-60"
                >
                  {geoStatus === 'requesting' ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Navigation className="w-3 h-3" />
                  )}
                  {geoStatus === 'requesting'
                    ? 'Locating…'
                    : geoStatus === 'denied'
                      ? 'Location permission denied — pick manually'
                      : geoStatus === 'unsupported'
                        ? 'Geolocation not supported here — pick manually'
                        : 'Use my location to find nearest'}
                </button>
              )}
            </div>
          )}
        </header>

        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-12 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading centers…
          </div>
        ) : sortedCenters.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 text-center text-sm text-slate-400">
            No active centers right now. Please check back soon.
          </div>
        ) : (
          <ul className="space-y-3">
            {sortedCenters.map(({ center, distance }) => {
              const isCurrent = center.id === currentCenterId;
              const isSwitching = switching === center.id;
              return (
                <li key={center.id}>
                  <button
                    onClick={() => handleSelect(center.id)}
                    disabled={isSwitching || isCurrent}
                    className={`w-full text-left rounded-2xl border p-4 transition-all ${
                      isCurrent
                        ? 'border-accent/40 bg-accent/[0.06]'
                        : 'border-white/[0.06] bg-white/[0.02] hover:border-accent/30 hover:bg-white/[0.04] cursor-pointer'
                    } ${isSwitching ? 'opacity-70' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-sm md:text-base font-bold text-white truncate">{center.name}</h2>
                          {isCurrent && (
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/15 text-accent flex items-center gap-1">
                              <Check className="w-3 h-3" /> Current
                            </span>
                          )}
                        </div>
                        {center.description && (
                          <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{center.description}</p>
                        )}
                      </div>
                      {distance !== null && (
                        <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-lg flex-shrink-0">
                          {distance < 1 ? `${(distance * 1000).toFixed(0)} m` : `${distance.toFixed(1)} km`}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-400">
                      {(center.addressLine1 || center.city) && (
                        <span className="flex items-start gap-1.5">
                          <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          <span className="truncate">
                            {[center.addressLine1, center.addressLine2, center.city, center.state, center.pincode]
                              .filter(Boolean)
                              .join(', ')}
                          </span>
                        </span>
                      )}
                      {center.contactPhone && (
                        <span className="flex items-center gap-1.5">
                          <Phone className="w-3 h-3 flex-shrink-0" />
                          {center.contactPhone}
                        </span>
                      )}
                      {center.contactEmail && (
                        <span className="flex items-center gap-1.5">
                          <Mail className="w-3 h-3 flex-shrink-0" />
                          {center.contactEmail}
                        </span>
                      )}
                    </div>

                    {!isCurrent && (
                      <div className="mt-3 flex items-center justify-end text-xs text-accent font-semibold">
                        {isSwitching ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                            Switching…
                          </>
                        ) : (
                          <>
                            Select <ArrowRight className="w-3.5 h-3.5 ml-1" />
                          </>
                        )}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <ContactFooter />
      </main>
    </div>
  );
}

function sortCenters(
  centers: PublicCenter[],
  coords: { lat: number; lon: number } | null,
): Array<{ center: PublicCenter; distance: number | null }> {
  if (!coords) return centers.map((c) => ({ center: c, distance: null }));
  const withDistance = centers.map((c) => {
    if (c.latitude == null || c.longitude == null) {
      return { center: c, distance: null as number | null };
    }
    return { center: c, distance: distanceKm(coords.lat, coords.lon, c.latitude, c.longitude) };
  });
  // Sort: known distances ascending, then unknown ones at the end.
  withDistance.sort((a, b) => {
    if (a.distance == null && b.distance == null) return 0;
    if (a.distance == null) return 1;
    if (b.distance == null) return -1;
    return a.distance - b.distance;
  });
  return withDistance;
}
