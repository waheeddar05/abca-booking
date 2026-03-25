'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// This page has been merged into the main operator dashboard.
// Redirect to /operator for backwards compatibility.
export default function OperatorBookingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/operator');
  }, [router]);
  return null;
}
