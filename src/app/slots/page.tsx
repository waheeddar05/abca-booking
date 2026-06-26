'use client';

import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import ResourceSlotsPage from './ResourceSlotsPage';

// All centers use the resource-based booking model. The legacy
// MACHINE_PITCH slot UI (SlotsContent + its components/hooks) has been
// removed; this page now renders the resource slot experience directly.
export default function SlotsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      }
    >
      <ResourceSlotsPage />
    </Suspense>
  );
}
