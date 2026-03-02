'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { MobileNumberPrompt } from '@/components/ui/MobileNumberPrompt';

export function MobileNumberCheck() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const checkedRef = useRef(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated' || checkedRef.current) return;
    if (!session?.user) return;

    // Don't show on admin or operator pages
    if (pathname.startsWith('/admin') || pathname.startsWith('/operator')) return;

    checkedRef.current = true;

    const checkProfile = async () => {
      try {
        const res = await fetch('/api/user/profile');
        if (!res.ok) return;

        const profile = await res.json();

        // Already has mobile number - no need to prompt
        if (profile.mobileNumber) {
          setChecked(true);
          return;
        }

        // User dismissed the prompt before
        if (profile.phonePromptDismissed) {
          setChecked(true);
          return;
        }

        // OTP users already provided a phone number to log in
        if (profile.authProvider === 'OTP') {
          setChecked(true);
          return;
        }

        // Show the prompt
        setShowPrompt(true);
        setChecked(true);
      } catch {
        // Silently fail - don't block the user experience
        setChecked(true);
      }
    };

    checkProfile();
  }, [status, session, pathname]);

  const handleSubmit = () => {
    setShowPrompt(false);
  };

  const handleDismiss = async () => {
    setShowPrompt(false);
    try {
      await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phonePromptDismissed: true }),
      });
    } catch {
      // Silently fail - prompt is already closed
    }
  };

  if (!checked || !showPrompt) return null;

  return (
    <MobileNumberPrompt
      open={showPrompt}
      onSubmit={handleSubmit}
      onDismiss={handleDismiss}
    />
  );
}
