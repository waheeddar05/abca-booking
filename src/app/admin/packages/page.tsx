'use client';

import { useCenter } from '@/lib/center-context';
import { ResourcePackagesPage } from '@/components/admin/ResourcePackagesPage';

// All centers use the resource-based package model. The legacy
// MACHINE_PITCH package admin (AdminPackagesLegacy + PackageForm) has
// been removed; this page renders the resource package manager directly.
export default function AdminPackagesPage() {
  const { currentCenter, loading } = useCenter();
  if (loading || !currentCenter) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500">
        Loading…
      </div>
    );
  }
  return <ResourcePackagesPage />;
}
