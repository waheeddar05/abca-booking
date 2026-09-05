'use client';

import { BadgeCheck, Mail, Phone, UserRound } from 'lucide-react';
import type { CurrentUser } from '@/lib/current-user';
import { ProfileNameEditor } from './ProfileNameEditor';
import { formatMobileDisplay, initialsOf } from './profile-format';

interface AccountCardProps {
  user: CurrentUser;
  /** Re-read the profile after the name changes. */
  onRefresh: () => Promise<void>;
}

/**
 * Who the signed-in account is: avatar initials, the editable name, the
 * mobile number the account is keyed on (with its verified state) and
 * the email when a legacy Google account has one.
 */
export function AccountCard({ user, onRefresh }: AccountCardProps) {
  const initials = initialsOf(user.name);
  const mobile = formatMobileDisplay(user.mobileNumber);

  return (
    <section
      aria-label="Account details"
      className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-4 animate-fade-in"
    >
      <div className="flex items-start gap-3.5">
        <div
          aria-hidden="true"
          className="w-14 h-14 rounded-full bg-accent/15 border border-accent/25 flex items-center justify-center shrink-0"
        >
          {initials ? (
            <span className="text-lg font-black text-accent tracking-wide">{initials}</span>
          ) : (
            <UserRound className="w-6 h-6 text-accent" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <ProfileNameEditor name={user.name} onSaved={onRefresh} />

          <dl className="mt-2.5 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <dt className="sr-only">Mobile number</dt>
              <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
              {mobile ? (
                <>
                  <dd className="text-slate-300 tabular-nums">{mobile}</dd>
                  {user.mobileVerified && (
                    <dd className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 px-2 py-0.5 text-[10px] font-semibold">
                      <BadgeCheck className="w-3 h-3" aria-hidden="true" />
                      Verified
                    </dd>
                  )}
                </>
              ) : (
                <dd className="text-slate-500">No mobile number linked</dd>
              )}
            </div>

            {user.email && (
              <div className="flex items-center gap-2 text-sm min-w-0">
                <dt className="sr-only">Email</dt>
                <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                <dd className="text-slate-300 truncate">{user.email}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </section>
  );
}
