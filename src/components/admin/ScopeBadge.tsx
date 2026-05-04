/**
 * Scope badge — surfaces *what* a settings page is editing so admins
 * never confuse "platform-wide defaults" (apply to every center, super-
 * admin only) with "this center" (apply only to the named center).
 *
 * Usage:
 *   <ScopeBadge scope="platform" />              // orange "PLATFORM-WIDE"
 *   <ScopeBadge scope="center" centerName="Toplay" /> // purple "TOPLAY"
 *
 * Pair with <ScopeBanner /> at the top of the page for fuller context.
 */
import { Globe2, MapPin } from 'lucide-react';

type Scope = 'platform' | 'center';

export function ScopeBadge({
  scope,
  centerName,
  className,
}: {
  scope: Scope;
  centerName?: string;
  className?: string;
}) {
  if (scope === 'platform') {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-amber-500/10 text-amber-300 border border-amber-500/30 ${className ?? ''}`}
      >
        <Globe2 className="w-3 h-3" />
        Platform-wide
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-purple-500/10 text-purple-300 border border-purple-500/30 ${className ?? ''}`}
    >
      <MapPin className="w-3 h-3" />
      {centerName ?? 'This center'}
    </span>
  );
}

/**
 * Full-width banner explaining the scope of the page in plain language.
 * Place at the top of any settings page so the admin sees it before
 * touching anything.
 */
export function ScopeBanner({
  scope,
  centerName,
  hint,
}: {
  scope: Scope;
  centerName?: string;
  /** One-line override of the default copy. */
  hint?: string;
}) {
  const isPlatform = scope === 'platform';
  const defaultHint = isPlatform
    ? 'These values apply to every center as the default. Per-center overrides live under Admin → Centers → [center] → Policies.'
    : `These settings apply only to ${centerName ?? 'this center'}. Other centers are unaffected.`;
  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded-xl border text-xs ${
        isPlatform
          ? 'bg-amber-500/[0.06] border-amber-500/20 text-amber-200/90'
          : 'bg-purple-500/[0.06] border-purple-500/20 text-purple-200/90'
      }`}
    >
      <ScopeBadge scope={scope} centerName={centerName} />
      <span className="leading-snug">{hint ?? defaultHint}</span>
    </div>
  );
}
