'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';

export function MobileNumberCheck() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const checkedRef = useRef(false);

  useEffect(() => {
    if (status !== 'authenticated' || checkedRef.current) return;
    if (!session?.user) return;

    // Don't redirect on admin, operator, or verify-mobile pages
    if (pathname.startsWith('/admin') || pathname.startsWith('/operator') || pathname.startsWith('/verify-mobile')) return;

    checkedRef.current = true;

    const checkProfile = async () => {
      try {
        const res = await fetch('/api/user/profile');
        if (!res.ok) return;

        const profile = await res.json();

        // Has mobile number AND verified - no need to prompt
        if (profile.mobileNumber && profile.mobileVerified) return;

        // User dismissed the prompt before
        if (profile.phonePromptDismissed) return;

        // OTP users already provided a phone number to log in
        if (profile.authProvider === 'OTP') return;

        // Redirect directly to verify-mobile page (single flow: enter phone → OTP → done)
        router.push('/verify-mobile');
      } catch {
        // Silently fail - don't block the user experience
      }
    };

    checkProfile();
  }, [status, session, pathname, router]);

  return null;
}
