'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Package,
  Plus,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Loader2,
  Users,
  BarChart3,
  Download,
  UserPlus,
  Search,
  Check,
  Calendar,
  Zap,
  Sun,
  Moon,
  Clock,
  RotateCcw,
  Trash2,
  ArrowDownAZ,
  ArrowUpAZ,
  X,
} from 'lucide-react';
import { NumberInputDialog } from '@/components/ui/NumberInputDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { ResourcePackagesPage } from '@/components/admin/ResourcePackagesPage';
import { useCenter } from '@/lib/center-context';
import {
  PACKAGE_WICKET_OPTIONS,
  PACKAGE_TIMING_OPTIONS,
  PACKAGE_WICKET_LABEL,
  PACKAGE_BALL_LABEL,
  PACKAGE_TIMING_LABEL,
  PACKAGE_TIMING_DAY_LABEL,
  PACKAGE_TIMING_EVENING_LABEL,
  packageCategoryLabel,
  ballOptionsFromEffective,
  isBallTypeValidForMachineType,
  coerceBallTypeFromEffective,
  coerceBallTypeForMachineType,
} from '@/lib/package-admin-labels';

interface PackageData {
  id: string;
  name: string;
  machineId: string | null;
  machineType: string;
  ballType: string;
  wicketType: string;
  timingType: string;
  totalSessions: number;
  validityDays: number;
  price: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraChargeRules: any;
  isActive: boolean;
  createdAt: string;
  category?: string | null;
  _count?: { userPackages: number };
}

/** Minimal Machine row shape returned by `/api/centers/[id]/machines`.
 *  We use it to dynamically populate the Machine dropdown in the
 *  Create / Edit / Assign forms — replacing the previously hard-coded
 *  GRAVITY/YANTRA/LEVERAGE list so the form always matches the
 *  current center's machines. The `legacyMachineId` ties the row back
 *  to the `MachineId` enum that ABCA packages still store. */
interface CenterMachineRow {
  id: string;
  name: string;
  shortName: string | null;
  isActive: boolean;
  legacyMachineId: string | null;
  machineType: { code: string; name: string; ballType: string; imageUrl: string | null };
  // Ball types this machine actually supports (server-computed). Tennis
  // machines resolve to ['TENNIS']; leather machines to ['LEATHER','MACHINE'].
  // Drives the Ball Type dropdown so it mirrors the real machine.
  effectiveBallTypes?: string[] | null;
}

// Wicket-upgrade paths (Pitch). Labels reuse the standardized
// PACKAGE_WICKET_LABEL so "Astroturf" / "Cement" / "Natural Turf"
// stay consistent everywhere they appear.
const ALL_WICKET_UPGRADE_PATHS = [
  { from: 'ASTRO',  to: 'CEMENT'  },
  { from: 'ASTRO',  to: 'NATURAL' },
  { from: 'CEMENT', to: 'NATURAL' },
] as const;

const defaultExtraChargeRules = {
  ballTypeUpgrade: 100,
  wicketTypeUpgrades: {} as Record<string, number>,
  machineUpgrades: {} as Record<string, number>,
  timingUpgrade: 125,
};

type MachineFilter = 'all' | string;

const emptyForm = {
  name: '',
  // Will be set to the first center machine once the list arrives.
  machineId: '' as string,
  machineType: 'LEATHER',
  ballType: 'LEATHER',
  wicketType: 'ASTRO',
  timingType: 'DAY',
  totalSessions: 4,
  validityDays: 30,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  price: '' as any,
  extraChargeRules: defaultExtraChargeRules,
  isActive: true,
};

// MACHINE_PITCH-only — package model is shaped around the legacy
// machine + ball + wicket triple. RESOURCE_BASED centers see the
// resource variant via the wrapper at the bottom of this file.
function AdminPackagesLegacy() {
  const { currentCenter } = useCenter();
  const [packages, setPackages] = useState<PackageData[]>([]);
  const [loading, setLoading] = useState(true);
  // Create Package form starts collapsed — admins click "+ Create" to
  // expand it. Editing flips this back on with `editingId` set, so the
  // edit panel still renders inline under the selected package row.
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [tab, setTab] = useState<'packages' | 'users' | 'reports' | 'assign'>('packages');
  const [machineFilter, setMachineFilter] = useState<MachineFilter>('all');
  const [timingFilter, setTimingFilter] = useState<'DAY' | 'EVENING' | ''>('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [reports, setReports] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [userPackages, setUserPackages] = useState<any[]>([]);
  const [userPkgStatusFilter, setUserPkgStatusFilter] = useState('');
  const [userPkgSearch, setUserPkgSearch] = useState('');
  const [userPkgSearchInput, setUserPkgSearchInput] = useState('');
  const [userPkgSort, setUserPkgSort] = useState<'NAME_ASC' | 'NAME_DESC'>('NAME_ASC');
  const [reportsLoading, setReportsLoading] = useState(false);
  const [userPkgLoading, setUserPkgLoading] = useState(false);
  const [numberDialog, setNumberDialog] = useState<{
    title: string;
    label: string;
    placeholder: string;
    confirmLabel: string;
    variant?: 'default' | 'danger';
    onConfirm: (value: number) => void;
  } | null>(null);
  const [cancelPackageId, setCancelPackageId] = useState<string | null>(null);

  // Center's actual machines, fetched on mount. Drives the Machine
  // dropdowns in the create/edit/assign forms instead of a hard-coded
  // GRAVITY/YANTRA/LEVERAGE list. Empty until the API responds.
  const [centerMachines, setCenterMachines] = useState<CenterMachineRow[]>([]);

  // CSV filter state
  const [csvFilters, setCsvFilters] = useState({
    status: '',
    packageId: '',
  });
  // Top-level date range for the Reports tab. Empty = existing default
  // behaviour (all-time data). Drives both the summary metrics and the
  // CSV export. Mirrors the Admin Dashboard date filter.
  const [reportRange, setReportRange] = useState({ from: '', to: '' });
  const [downloadingCsv, setDownloadingCsv] = useState(false);

  // Assign tab state
  const [assignSearch, setAssignSearch] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [assignSearchResults, setAssignSearchResults] = useState<any[]>([]);
  const [assignSearching, setAssignSearching] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [assignForm, setAssignForm] = useState({
    name: '',
    machineId: '' as string,
    machineType: 'LEATHER',
    ballType: 'LEATHER',
    wicketType: 'ASTRO',
    timingType: 'DAY',
    totalSessions: 4,
    validityDays: 30,
  });
  const [assigning, setAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState({ text: '', type: '' });

  // Pull the active machines for the current center. We rely on
  // `legacyMachineId` to map each Machine row back to the MachineId
  // enum the Package table stores (`Package.machineId`). ABCA's
  // seeded machines all have this set; if a new machine lacks it the
  // dropdown still shows it (label-only) but selecting it falls back
  // to the machineType category.
  useEffect(() => {
    if (!currentCenter?.id) return;
    let cancelled = false;
    fetch(`/api/centers/${currentCenter.id}/machines`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: CenterMachineRow[]) => {
        if (cancelled) return;
        const active = Array.isArray(data) ? data.filter((m) => m.isActive) : [];
        setCenterMachines(active);
        // Seed the form's machine pick once the list is in so the
        // create form has a sensible default instead of an empty
        // string when an admin opens it.
        setForm((f) => {
          if (f.machineId) return f;
          const first = active.find((m) => m.legacyMachineId) || active[0];
          if (!first) return f;
          const mt = first.machineType.ballType === 'TENNIS' ? 'TENNIS' : 'LEATHER';
          return {
            ...f,
            machineId: first.legacyMachineId || first.id,
            machineType: mt,
            ballType: coerceBallTypeFromEffective(first.effectiveBallTypes, f.ballType),
          };
        });
        setAssignForm((f) => {
          if (f.machineId) return f;
          const first = active.find((m) => m.legacyMachineId) || active[0];
          if (!first) return f;
          const mt = first.machineType.ballType === 'TENNIS' ? 'TENNIS' : 'LEATHER';
          return {
            ...f,
            machineId: first.legacyMachineId || first.id,
            machineType: mt,
            ballType: coerceBallTypeFromEffective(first.effectiveBallTypes, f.ballType),
          };
        });
      })
      .catch(() => { if (!cancelled) setCenterMachines([]); });
    return () => { cancelled = true; };
  }, [currentCenter?.id]);

  /** Resolve the currently-selected machine option (by `legacyMachineId`
   *  if the Package row uses the enum, falling back to the Machine row
   *  `id`). Used to gate Ball-Type rendering and to derive
   *  `machineType` (LEATHER/TENNIS) on selection. */
  const findMachineOption = (value: string): CenterMachineRow | undefined => {
    if (!value) return undefined;
    return centerMachines.find((m) => m.legacyMachineId === value)
      || centerMachines.find((m) => m.id === value);
  };

  const searchUsers = async (query: string) => {
    if (!query || query.length < 2) { setAssignSearchResults([]); return; }
    setAssignSearching(true);
    try {
      const res = await fetch(`/api/admin/users?search=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setAssignSearchResults(Array.isArray(data) ? data : data.users || []);
      }
    } catch (e) {
      console.error('User search failed', e);
    } finally {
      setAssignSearching(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => searchUsers(assignSearch), 300);
    return () => clearTimeout(timer);
  }, [assignSearch]);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) { setAssignMessage({ text: 'Please select a user', type: 'error' }); return; }
    if (!assignForm.name.trim()) { setAssignMessage({ text: 'Please enter a package name', type: 'error' }); return; }
    // Bowling Machine assignments must be pinned to a specific machine —
    // "Any Bowling Machine" is no longer a valid choice. The dropdown
    // already restricts to the center's active machines; this guards
    // the case where the center has zero machines configured.
    if (!assignForm.machineId) { setAssignMessage({ text: 'Please select a machine', type: 'error' }); return; }
    // Timing must be a concrete slot (Day or Evening) — "Both"/"Anytime"
    // is not offered to keep package redemption deterministic.
    if (assignForm.timingType !== 'DAY' && assignForm.timingType !== 'EVENING') {
      setAssignMessage({ text: 'Please select a timing (Day or Evening)', type: 'error' });
      return;
    }
    if (!assignForm.totalSessions || assignForm.totalSessions <= 0) { setAssignMessage({ text: 'Sessions must be a positive number', type: 'error' }); return; }
    if (!assignForm.validityDays || assignForm.validityDays <= 0) { setAssignMessage({ text: 'Validity days must be a positive number', type: 'error' }); return; }
    if (!isBallTypeValidForMachineType(assignForm.machineType, assignForm.ballType)) {
      setAssignMessage({ text: 'Selected ball type is not valid for this machine type', type: 'error' });
      return;
    }

    setAssigning(true);
    setAssignMessage({ text: '', type: '' });
    try {
      const res = await fetch('/api/admin/packages/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id, ...assignForm }),
      });
      if (res.ok) {
        setAssignMessage({ text: `Custom package assigned to ${selectedUser.name || selectedUser.mobileNumber || selectedUser.email}`, type: 'success' });
        setSelectedUser(null);
        setAssignSearch('');
        setAssignSearchResults([]);
        // Reset but keep the first machine as default again.
        const first = centerMachines.find((m) => m.legacyMachineId) || centerMachines[0];
        const firstMachineType = first?.machineType.ballType === 'TENNIS' ? 'TENNIS' : 'LEATHER';
        setAssignForm({
          name: '',
          machineId: first ? (first.legacyMachineId || first.id) : '',
          machineType: firstMachineType,
          ballType: coerceBallTypeFromEffective(first?.effectiveBallTypes, 'LEATHER'),
          wicketType: 'ASTRO',
          timingType: 'DAY',
          totalSessions: 4,
          validityDays: 30,
        });
      } else {
        const data = await res.json();
        setAssignMessage({ text: data.error || 'Failed to assign package', type: 'error' });
      }
    } catch {
      setAssignMessage({ text: 'Internal server error', type: 'error' });
    } finally {
      setAssigning(false);
    }
  };

  const handleDownloadCsv = async () => {
    setDownloadingCsv(true);
    try {
      const params = new URLSearchParams();
      if (csvFilters.status) params.set('status', csvFilters.status);
      if (csvFilters.packageId) params.set('packageId', csvFilters.packageId);
      // Respect the top-level Reports date range so the export matches
      // the on-screen summary.
      if (reportRange.from) params.set('fromDate', reportRange.from);
      if (reportRange.to) params.set('toDate', reportRange.to);
      const res = await fetch(`/api/admin/packages/reports/csv?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to download');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `packages-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('CSV download failed', e);
    } finally {
      setDownloadingCsv(false);
    }
  };

  const fetchPackages = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/packages');
      if (res.ok) setPackages(await res.json());
    } catch (e) {
      console.error('Failed to fetch packages', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchReports = async () => {
    setReportsLoading(true);
    try {
      const params = new URLSearchParams();
      if (reportRange.from) params.set('from', reportRange.from);
      if (reportRange.to) params.set('to', reportRange.to);
      const qs = params.toString();
      const res = await fetch(`/api/admin/packages/reports${qs ? `?${qs}` : ''}`);
      if (res.ok) setReports(await res.json());
    } catch (e) {
      console.error('Failed to fetch reports', e);
    } finally {
      setReportsLoading(false);
    }
  };

  const fetchUserPackages = async (statusOverride?: string, searchOverride?: string) => {
    setUserPkgLoading(true);
    try {
      const params = new URLSearchParams();
      const status = statusOverride ?? userPkgStatusFilter;
      const search = searchOverride ?? userPkgSearch;
      if (status) params.set('status', status);
      if (search) params.set('search', search);
      const qs = params.toString();
      const res = await fetch(`/api/admin/packages/user-packages${qs ? `?${qs}` : ''}`);
      if (res.ok) setUserPackages(await res.json());
    } catch (e) {
      console.error('Failed to fetch user packages', e);
    } finally {
      setUserPkgLoading(false);
    }
  };

  useEffect(() => {
    fetchPackages();
  }, []);

  useEffect(() => {
    if (tab === 'reports') fetchReports();
    if (tab === 'users') fetchUserPackages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, reportRange.from, reportRange.to]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0) {
      setMessage({ text: 'Please enter a valid price', type: 'error' });
      return;
    }
    if (!isBallTypeValidForMachineType(form.machineType, form.ballType)) {
      setMessage({ text: 'Selected ball type is not valid for this machine type', type: 'error' });
      return;
    }
    try {
      const method = editingId ? 'PUT' : 'POST';
      const body = editingId ? { ...form, price: Number(form.price), id: editingId } : { ...form, price: Number(form.price) };
      const res = await fetch('/api/admin/packages', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setMessage({ text: editingId ? 'Package updated' : 'Package created', type: 'success' });
        setShowForm(false);
        setEditingId(null);
        setForm(emptyForm);
        fetchPackages();
      } else {
        const data = await res.json();
        setMessage({ text: data.error || 'Failed', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Internal server error', type: 'error' });
    }
  };

  const toggleActive = async (pkg: PackageData) => {
    try {
      const res = await fetch('/api/admin/packages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pkg.id, isActive: !pkg.isActive }),
      });
      if (res.ok) fetchPackages();
    } catch (e) {
      console.error('Toggle failed', e);
    }
  };


  const startEdit = (pkg: PackageData) => {
    // Resolve the machine this package points at. ABCA packages store the
    // legacy MachineId enum in `pkg.machineId`; newer centers store the
    // Machine row id. When the package predates the machineId column
    // (null), fall back to a machine of the SAME category as the
    // package's machineType — a TENNIS package must not resolve to a
    // leather machine (and vice versa), or the hidden machineType ends up
    // contradicting the visible machine/ball-type selectors.
    const wantTennis = pkg.machineType === 'TENNIS';
    const sameCategory = (m: CenterMachineRow) =>
      (m.machineType.ballType === 'TENNIS') === wantTennis;
    const fallbackMachine =
      centerMachines.find((m) => sameCategory(m) && m.legacyMachineId)
      || centerMachines.find((m) => sameCategory(m))
      || centerMachines.find((m) => m.legacyMachineId)
      || centerMachines[0];
    const storedMachineId = pkg.machineId
      || fallbackMachine?.legacyMachineId
      || fallbackMachine?.id
      || (pkg.machineType === 'LEATHER' ? 'GRAVITY' : 'LEVERAGE_INDOOR');

    // Keep machineType in lockstep with the resolved machine so the
    // hidden form.machineType can never disagree with the visible
    // machine + ball-type selectors — that mismatch was the source of the
    // false "Invalid Ball Type" failure on Update.
    const machineOption = findMachineOption(storedMachineId);
    const resolvedMachineType = machineOption
      ? (machineOption.machineType.ballType === 'TENNIS' ? 'TENNIS' : 'LEATHER')
      : pkg.machineType;

    const rules = pkg.extraChargeRules || defaultExtraChargeRules;
    // Migrate old flat wicketTypeUpgrade to new wicketTypeUpgrades object
    let wicketTypeUpgrades = rules.wicketTypeUpgrades || {};
    if (!rules.wicketTypeUpgrades && rules.wicketTypeUpgrade) {
      wicketTypeUpgrades = {};
      ALL_WICKET_UPGRADE_PATHS.forEach(p => { wicketTypeUpgrades[`${p.from}_TO_${p.to}`] = rules.wicketTypeUpgrade; });
    }
    const machineUpgrades = rules.machineUpgrades || {};
    // BOTH (legacy leather option) collapses to Leather in the editor;
    // coerce against the machine's supported ball types so a value the
    // machine no longer offers (e.g. a stale "Machine" on a tennis
    // machine) snaps to a valid option. The final
    // coerceBallTypeForMachineType pass guarantees the ball type is
    // compatible with resolvedMachineType even before the machine list
    // has loaded (machineOption undefined → effective fallback could
    // otherwise leave a TENNIS package on 'LEATHER').
    const ballType = coerceBallTypeForMachineType(
      resolvedMachineType,
      coerceBallTypeFromEffective(
        machineOption?.effectiveBallTypes,
        pkg.ballType === 'BOTH' ? 'LEATHER' : pkg.ballType,
      ),
    );
    setForm({
      name: pkg.name,
      machineId: storedMachineId,
      machineType: resolvedMachineType,
      ballType,
      wicketType: pkg.wicketType || 'ASTRO',
      timingType: pkg.timingType === 'BOTH' ? 'DAY' : pkg.timingType,
      totalSessions: pkg.totalSessions,
      validityDays: pkg.validityDays,
      price: pkg.price,
      extraChargeRules: { ...rules, wicketTypeUpgrades, machineUpgrades },
      isActive: pkg.isActive,
    });
    setEditingId(pkg.id);
    setShowForm(true);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleUserAction = async (userPackageId: string, action: string, params: Record<string, any> = {}) => {
    try {
      const res = await fetch('/api/admin/packages/user-packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPackageId, action, ...params }),
      });
      if (res.ok) {
        setMessage({ text: 'Action completed', type: 'success' });
        fetchUserPackages();
      } else {
        const data = await res.json();
        setMessage({ text: data.error || 'Action failed', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Internal server error', type: 'error' });
    }
  };

  /** Display label for a machine identifier on a Package row. We try
   *  to resolve via `legacyMachineId` first (ABCA's enum-stored
   *  packages), then via the Machine row id; otherwise fall through to
   *  the raw value so legacy values like GRAVITY still render. */
  const machineDisplay = (idOrLegacy: string | null | undefined): string => {
    if (!idOrLegacy) return '';
    const m = findMachineOption(idOrLegacy);
    if (m) return m.shortName || m.name;
    return idOrLegacy;
  };

  const isLeatherSelectedMachine = (machineKey: string): boolean => {
    const m = findMachineOption(machineKey);
    if (m) return m.machineType.ballType !== 'TENNIS';
    // Fallback for the legacy enum values when the center hasn't
    // surfaced its machines yet.
    return machineKey === 'GRAVITY' || machineKey === 'YANTRA';
  };

  /** True when the selected machine is a tennis machine (Leverage).
   *  Tennis machines have no Leather/Machine ball-type axis — they
   *  always use tennis balls — so the Ball Type field shows a fixed
   *  "Tennis" value instead of the Leather/Machine picker. */
  const isTennisSelectedMachine = (machineKey: string): boolean => {
    const m = findMachineOption(machineKey);
    if (m) return m.machineType.ballType === 'TENNIS';
    return machineKey === 'LEVERAGE_INDOOR' || machineKey === 'LEVERAGE_OUTDOOR';
  };

  const hasActiveFilter = machineFilter !== 'all' || timingFilter !== '';
  const clearFilters = () => { setMachineFilter('all'); setTimingFilter(''); };

  const filteredPackages = useMemo(() => {
    let filtered = packages;
    if (machineFilter !== 'all') {
      const target = findMachineOption(machineFilter);
      if (target) {
        // Match against either the package's machineId enum or the
        // category (LEATHER/TENNIS), so older packages without
        // `machineId` still group correctly.
        const targetCategory = target.machineType.ballType === 'TENNIS' ? 'TENNIS' : 'LEATHER';
        const legacyId = target.legacyMachineId;
        filtered = filtered.filter((pkg) =>
          pkg.machineId
            ? pkg.machineId === legacyId
            : pkg.machineType === targetCategory,
        );
      }
    }
    if (timingFilter) {
      filtered = filtered.filter(pkg => pkg.timingType === timingFilter || pkg.timingType === 'BOTH');
    }
    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packages, machineFilter, timingFilter, centerMachines]);

  // Sort user packages alphabetically by the holder's name (falling back to
  // email/mobile so unnamed users still order predictably).
  const sortedUserPackages = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nameOf = (up: any) =>
      (up.user?.name || up.user?.email || up.user?.mobileNumber || '').toLowerCase();
    return [...userPackages].sort((a, b) => {
      const cmp = nameOf(a).localeCompare(nameOf(b));
      return userPkgSort === 'NAME_ASC' ? cmp : -cmp;
    });
  }, [userPackages, userPkgSort]);

  // Tabs definition — matches the visual treatment of /admin/centers/[id]
  // (border-bottom strip with active border accent). Keeps the surface
  // consistent across the admin app.
  const TABS = [
    { key: 'packages', label: 'Packages',      icon: Package },
    { key: 'users',    label: 'User Packages', icon: Users },
    { key: 'assign',   label: 'Assign',        icon: UserPlus },
    { key: 'reports',  label: 'Reports',       icon: BarChart3 },
  ] as const;

  return (
    <div>
      <AdminPageHeader icon={Package} title="Packages" description="Manage subscription packages" />

      {/* Tabs — mirrors the style used on /admin/centers/[id] */}
      <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-2 mb-4 border-b border-white/[0.06] no-scrollbar">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                active
                  ? 'bg-accent/10 text-accent border-b-2 border-accent'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {message.text && (
        <p className={`mb-4 text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}

      {/* PACKAGES TAB */}
      {tab === 'packages' && (
        <>
          {/* "+ Create" toggle — form starts collapsed. Editing flips
              the panel on independently (see `startEdit`). */}
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => {
                // Toggle: closing also clears any in-progress edit
                // so the next open is a fresh "Create" state.
                setShowForm((s) => !s);
                setEditingId(null);
                setForm(emptyForm);
              }}
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
          {showForm && !editingId ? (
            <>Cancel</>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              Create Package
            </>
          )}
            </button>
          </div>

          {/* ─── Filters (only shown when the form is closed) ─── */}
          {!showForm && (
            <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-4 mb-5">
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Machine</label>
                  {hasActiveFilter && (
                    <button onClick={clearFilters} className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-accent transition-colors cursor-pointer">
                      <RotateCcw className="w-3 h-3" />
                      Clear filters
                    </button>
                  )}
                </div>
                {centerMachines.length === 0 ? (
                  <p className="text-[10px] text-slate-500 italic">Loading machines…</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    {centerMachines.map((m) => {
                      const filterValue = m.legacyMachineId || m.id;
                      const isSelected = machineFilter === filterValue;
                      const img = m.machineType.imageUrl
                        || (m.machineType.code === 'YANTRA' ? '/images/yantra-machine.jpeg'
                          : m.machineType.code === 'GRAVITY' ? '/images/leathermachine.jpeg'
                          : m.machineType.code === 'LEVERAGE' ? '/images/tennismachine.jpeg'
                          : '/images/leathermachine.jpeg');
                      const sub = m.machineType.ballType === 'TENNIS' ? 'Tennis' : 'Leather';
                      return (
                        <button
                          key={m.id}
                          onClick={() => { setMachineFilter(isSelected ? 'all' : filterValue); setTimingFilter(''); }}
                          className={`flex items-center gap-1.5 px-1.5 py-1 rounded-lg transition-all cursor-pointer text-left ${isSelected ? 'bg-accent/15 ring-1 ring-accent/50 shadow-sm' : 'bg-white/[0.04] border border-white/[0.08] hover:border-accent/30'}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img} alt={m.shortName || m.name} className="w-7 h-7 rounded-md object-cover flex-shrink-0" />
                          <div className="min-w-0">
                            <span className={`text-[10px] font-bold leading-tight ${isSelected ? 'text-accent' : 'text-slate-300'}`}>{m.shortName || m.name}</span>
                            <p className={`text-[8px] ${isSelected ? 'text-accent/70' : 'text-slate-500'}`}>{sub}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider">Timing</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: 'DAY' as const, label: 'Day', Icon: Sun },
                    { key: 'EVENING' as const, label: 'Evening', Icon: Moon },
                  ]).map(t => {
                    const active = timingFilter === t.key;
                    const label = t.key === 'DAY' ? PACKAGE_TIMING_DAY_LABEL : PACKAGE_TIMING_EVENING_LABEL;
                    return (
                      <button key={t.key} onClick={() => setTimingFilter(active ? '' : t.key)}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all cursor-pointer text-left ${active ? 'bg-accent/15 ring-1 ring-accent/50 shadow-sm' : 'bg-white/[0.04] border border-white/[0.08] hover:border-accent/30'}`}>
                        <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${active ? 'bg-accent/20' : 'bg-white/[0.06]'}`}>
                          <t.Icon className={`w-3.5 h-3.5 ${active ? 'text-accent' : 'text-slate-400'}`} />
                        </div>
                        <div className="min-w-0">
                          <span className={`text-[10px] font-bold block ${active ? 'text-accent' : 'text-slate-300'}`}>{t.label}</span>
                          <span className={`text-[8px] block ${active ? 'text-accent/70' : 'text-slate-500'}`}>{label}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {showForm && !editingId && (
            <PackageForm
              form={form}
              setForm={setForm}
              centerMachines={centerMachines}
              isLeatherSelectedMachine={isLeatherSelectedMachine}
              isTennisSelectedMachine={isTennisSelectedMachine}
              findMachineOption={findMachineOption}
              onSubmit={handleSubmit}
              submitLabel="Create Package"
              onCancel={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); }}
              heading="New Package"
            />
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Loading packages...</span>
            </div>
          ) : filteredPackages.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
                <Package className="w-5 h-5 text-slate-500" />
              </div>
              <p className="text-sm text-slate-400 mb-1">{hasActiveFilter ? 'No packages match your filters' : 'No packages created yet'}</p>
              {hasActiveFilter && (
                <button onClick={clearFilters} className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-light transition-colors cursor-pointer mt-2">
                  <RotateCcw className="w-3.5 h-3.5" />
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Available Packages — visual structure mirrors the
                  user-side `/packages` cards (PackageSection in
                  src/app/packages/page.tsx). Admin-specific actions
                  (Edit / Toggle active) sit at the card footer. */}
              {filteredPackages.map(pkg => (
                <div key={pkg.id}>
                  <AdminPackageCard
                    pkg={pkg}
                    machineDisplay={machineDisplay}
                    onEdit={() => startEdit(pkg)}
                    onToggle={() => toggleActive(pkg)}
                    editing={editingId === pkg.id}
                  />
                  {editingId === pkg.id && showForm && (
                    <div className="mt-1">
                      <PackageForm
                        form={form}
                        setForm={setForm}
                        centerMachines={centerMachines}
                        isLeatherSelectedMachine={isLeatherSelectedMachine}
                        isTennisSelectedMachine={isTennisSelectedMachine}
                        findMachineOption={findMachineOption}
                        onSubmit={handleSubmit}
                        submitLabel="Update Package"
                        onCancel={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); }}
                        heading="Edit Package"
                        compact
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* USER PACKAGES TAB */}
      {tab === 'users' && (
        <>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <div className="flex gap-1.5 flex-wrap">
              {[
                { value: '', label: 'All' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'EXPIRED', label: 'Expired' },
                { value: 'CANCELLED', label: 'Cancelled' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setUserPkgStatusFilter(opt.value);
                    fetchUserPackages(opt.value, userPkgSearch);
                  }}
                  className={`px-3 py-1.5 text-[11px] font-medium rounded-lg transition-colors cursor-pointer ${
                    userPkgStatusFilter === opt.value
                      ? 'bg-accent/20 text-accent border border-accent/30'
                      : 'bg-white/[0.04] text-slate-400 border border-white/[0.07] hover:bg-white/[0.08]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <form
              className="flex-1 flex gap-1.5"
              onSubmit={e => {
                e.preventDefault();
                setUserPkgSearch(userPkgSearchInput);
                fetchUserPackages(userPkgStatusFilter, userPkgSearchInput);
              }}
            >
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search by name, email or mobile..."
                  value={userPkgSearchInput}
                  onChange={e => setUserPkgSearchInput(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg pl-8 pr-3 py-1.5 text-[11px] outline-none focus:border-accent placeholder:text-slate-600"
                />
              </div>
              <button
                type="submit"
                className="px-3 py-1.5 bg-accent/20 text-accent text-[11px] font-medium rounded-lg hover:bg-accent/30 transition-colors cursor-pointer"
              >
                Search
              </button>
              {userPkgSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setUserPkgSearchInput('');
                    setUserPkgSearch('');
                    fetchUserPackages(userPkgStatusFilter, '');
                  }}
                  className="px-2 py-1.5 text-slate-400 text-[11px] rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setUserPkgSort(s => (s === 'NAME_ASC' ? 'NAME_DESC' : 'NAME_ASC'))}
                title={userPkgSort === 'NAME_ASC' ? 'Sorted A–Z (tap for Z–A)' : 'Sorted Z–A (tap for A–Z)'}
                className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 bg-white/[0.04] text-slate-300 border border-white/[0.07] text-[11px] font-medium rounded-lg hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                {userPkgSort === 'NAME_ASC'
                  ? <ArrowDownAZ className="w-3.5 h-3.5" />
                  : <ArrowUpAZ className="w-3.5 h-3.5" />}
                {userPkgSort === 'NAME_ASC' ? 'A–Z' : 'Z–A'}
              </button>
            </form>
          </div>

          {userPkgLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Loading user packages...</span>
            </div>
          ) : userPackages.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm text-slate-400">No user packages found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {sortedUserPackages.map((up: any) => (
                <div key={up.id} className="bg-white/[0.03] backdrop-blur-sm rounded-2xl border border-white/[0.07] p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-white truncate">{up.user?.name || up.user?.email || 'Unknown'}</span>
                        <span className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium ${up.status === 'ACTIVE' ? 'bg-green-500/15 text-green-400' :
                            up.status === 'EXPIRED' ? 'bg-red-500/15 text-red-400' :
                              'bg-slate-500/15 text-slate-400'
                          }`}>
                          {up.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mb-1">{up.package?.name}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                        <span>Used: {up.usedSessions}/{up.totalSessions}</span>
                        <span>Remaining: {up.totalSessions - up.usedSessions}</span>
                        <span>Expires: {new Date(up.expiryDate).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {up.status === 'ACTIVE' && (
                        <>
                          <button
                            onClick={() => setNumberDialog({
                              title: 'Extend Expiry',
                              label: 'Days to extend',
                              placeholder: 'e.g. 7',
                              confirmLabel: 'Extend',
                              onConfirm: (days) => { setNumberDialog(null); handleUserAction(up.id, 'EXTEND_EXPIRY', { days }); },
                            })}
                            className="px-2 py-1 text-[10px] bg-blue-500/15 text-blue-400 rounded-lg hover:bg-blue-500/25 cursor-pointer"
                            title="Add days to expiry"
                          >
                            +Days
                          </button>
                          <button
                            onClick={() => setNumberDialog({
                              title: 'Reduce Expiry',
                              label: 'Days to reduce',
                              placeholder: 'e.g. 3',
                              confirmLabel: 'Reduce',
                              variant: 'danger',
                              onConfirm: (days) => { setNumberDialog(null); handleUserAction(up.id, 'EXTEND_EXPIRY', { days: -days }); },
                            })}
                            className="px-2 py-1 text-[10px] bg-orange-500/15 text-orange-400 rounded-lg hover:bg-orange-500/25 cursor-pointer"
                            title="Reduce days from expiry"
                          >
                            -Days
                          </button>
                          <button
                            onClick={() => setNumberDialog({
                              title: 'Add Sessions',
                              label: 'Sessions to add',
                              placeholder: 'e.g. 5',
                              confirmLabel: 'Add',
                              onConfirm: (sessions) => { setNumberDialog(null); handleUserAction(up.id, 'ADD_SESSIONS', { sessions }); },
                            })}
                            className="px-2 py-1 text-[10px] bg-green-500/15 text-green-400 rounded-lg hover:bg-green-500/25 cursor-pointer"
                            title="Increase total sessions"
                          >
                            +Sessions
                          </button>
                          <button
                            onClick={() => setNumberDialog({
                              title: 'Reduce Sessions',
                              label: 'Sessions to reduce',
                              placeholder: 'e.g. 2',
                              confirmLabel: 'Reduce',
                              variant: 'danger',
                              onConfirm: (sessions) => { setNumberDialog(null); handleUserAction(up.id, 'REDUCE_SESSIONS', { sessions }); },
                            })}
                            className="px-2 py-1 text-[10px] bg-yellow-500/15 text-yellow-400 rounded-lg hover:bg-yellow-500/25 cursor-pointer"
                            title="Decrease total sessions"
                          >
                            -Sessions
                          </button>
                          <button
                            onClick={() => setCancelPackageId(up.id)}
                            className="px-2 py-1 text-[10px] bg-red-500/15 text-red-400 rounded-lg hover:bg-red-500/25 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ASSIGN TAB */}
      {tab === 'assign' && (
        <div className="space-y-3 max-w-2xl">
          {assignMessage.text && (
            <p className={`text-sm ${assignMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {assignMessage.text}
            </p>
          )}

          {/* User Search */}
          <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] p-3">
            <h3 className="text-xs font-bold text-white mb-2 flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-accent" />
              Select User
            </h3>
            {selectedUser ? (
              <div className="flex items-center justify-between bg-accent/10 border border-accent/30 rounded-lg px-3 py-2">
                <div>
                  <span className="text-sm font-semibold text-white">{selectedUser.name || 'No name'}</span>
                  <span className="text-xs text-slate-400 ml-2">{selectedUser.mobileNumber || selectedUser.email}</span>
                </div>
                <button
                  onClick={() => { setSelectedUser(null); setAssignSearch(''); setAssignSearchResults([]); }}
                  className="text-xs text-red-400 hover:text-red-300 cursor-pointer"
                >
                  Change
                </button>
              </div>
            ) : (
              <div>
                <div className="relative">
                  <input
                    type="text"
                    value={assignSearch}
                    onChange={e => setAssignSearch(e.target.value)}
                    placeholder="Search by name, mobile, or email..."
                    className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent placeholder:text-slate-500"
                  />
                  {assignSearching && <Loader2 className="w-4 h-4 animate-spin text-slate-400 absolute right-3 top-3" />}
                </div>
                {assignSearchResults.length > 0 && (
                  <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {assignSearchResults.map((u: any) => (
                      <button
                        key={u.id}
                        onClick={() => { setSelectedUser(u); setAssignSearchResults([]); setAssignSearch(''); }}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
                      >
                        <span className="text-sm text-white">{u.name || 'No name'}</span>
                        <span className="text-xs text-slate-400 ml-2">{u.mobileNumber || u.email}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Package Config Form */}
          <form onSubmit={handleAssign} className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] p-3 space-y-3">
            <h3 className="text-xs font-bold text-white mb-1 flex items-center gap-2">
              <Package className="w-3.5 h-3.5 text-accent" />
              Package Details
            </h3>

            <div>
              <label className="block text-[10px] font-medium text-slate-400 mb-1">Package Name</label>
              <input
                type="text"
                value={assignForm.name}
                onChange={e => setAssignForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Custom 10 Sessions for John"
                className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent placeholder:text-slate-500"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">
                  Machine <span className="text-accent">*</span>
                </label>
                <select
                  value={assignForm.machineId}
                  onChange={e => {
                    const m = findMachineOption(e.target.value);
                    const nextMachineType = m?.machineType.ballType === 'TENNIS' ? 'TENNIS' : 'LEATHER';
                    setAssignForm(prev => ({
                      ...prev,
                      machineId: e.target.value,
                      machineType: nextMachineType,
                      // Auto-clear a ball type the new machine doesn't
                      // support (e.g. a tennis machine offers Tennis only).
                      ballType: coerceBallTypeFromEffective(m?.effectiveBallTypes, prev.ballType),
                    }));
                  }}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent"
                  required
                >
                  {/* No "Any Bowling Machine" option — admin must pick a
                      specific machine from the current center's roster. */}
                  {!assignForm.machineId && (
                    <option value="" disabled>Select a machine…</option>
                  )}
                  {centerMachines.map(m => (
                    <option key={m.id} value={m.legacyMachineId || m.id}>
                      {m.shortName || m.name}
                    </option>
                  ))}
                </select>
              </div>
              {(isLeatherSelectedMachine(assignForm.machineId) || isTennisSelectedMachine(assignForm.machineId)) && (
                <div>
                  <label className="block text-[10px] font-medium text-slate-400 mb-1">Ball Type</label>
                  <select
                    value={assignForm.ballType}
                    onChange={e => setAssignForm(prev => ({ ...prev, ballType: e.target.value }))}
                    className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent"
                  >
                    {ballOptionsFromEffective(findMachineOption(assignForm.machineId)?.effectiveBallTypes).map(b => (
                      <option key={b.value} value={b.value}>{b.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Wicket Type</label>
                <select
                  value={assignForm.wicketType}
                  onChange={e => setAssignForm(prev => ({ ...prev, wicketType: e.target.value }))}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent"
                >
                  {PACKAGE_WICKET_OPTIONS.map(w => (
                    <option key={w.value} value={w.value}>{w.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">
                  Timing <span className="text-accent">*</span>
                </label>
                <select
                  value={assignForm.timingType}
                  onChange={e => setAssignForm(prev => ({ ...prev, timingType: e.target.value }))}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent"
                  required
                >
                  {/* Only Day / Evening — "Anytime" / "Both" intentionally
                      dropped so the redemption window is unambiguous. */}
                  {PACKAGE_TIMING_OPTIONS.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Total Sessions</label>
                <input
                  type="number"
                  min={1}
                  value={assignForm.totalSessions}
                  onChange={e => setAssignForm(prev => ({ ...prev, totalSessions: parseInt(e.target.value) || 0 }))}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Validity (Days)</label>
                <input
                  type="number"
                  min={1}
                  value={assignForm.validityDays}
                  onChange={e => setAssignForm(prev => ({ ...prev, validityDays: parseInt(e.target.value) || 0 }))}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={
                assigning ||
                !selectedUser ||
                !assignForm.machineId ||
                (assignForm.timingType !== 'DAY' && assignForm.timingType !== 'EVENING')
              }
              className="w-full bg-accent hover:bg-accent-light text-primary font-semibold py-2.5 rounded-lg text-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {assigning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {assigning ? 'Assigning...' : 'Assign Custom Package'}
            </button>
          </form>
        </div>
      )}

      {/* REPORTS TAB */}
      {tab === 'reports' && (
        <div className="space-y-5">
          {/* Date Filter — identical design/behaviour to the Admin Dashboard */}
          <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] p-4">
            <div className="flex flex-col sm:flex-row items-end gap-4">
              <div className="grid grid-cols-2 gap-4 flex-1 w-full max-w-md">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">From Date</label>
                  <input
                    type="date"
                    value={reportRange.from}
                    onChange={e => setReportRange(prev => ({ ...prev, from: e.target.value }))}
                    className="w-full bg-slate-900/50 border border-white/[0.1] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 [color-scheme:dark]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">To Date</label>
                  <input
                    type="date"
                    value={reportRange.to}
                    onChange={e => setReportRange(prev => ({ ...prev, to: e.target.value }))}
                    className="w-full bg-slate-900/50 border border-white/[0.1] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 [color-scheme:dark]"
                  />
                </div>
              </div>
              {(reportRange.from || reportRange.to) && (
                <button
                  onClick={() => setReportRange({ from: '', to: '' })}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors px-3 py-2 bg-white/[0.05] rounded-lg border border-white/[0.05] mb-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                  Reset
                </button>
              )}
            </div>
          </div>

          {reportsLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Loading reports...</span>
            </div>
          ) : reports ? (
          <>
            {/* Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {[
                { label: 'Active Packages', value: reports.activePackages },
                { label: 'Expired Packages', value: reports.expiredPackages },
                { label: 'Total Sessions Sold', value: reports.totalSessionsSold },
                { label: 'Sessions Consumed', value: reports.totalSessionsConsumed },
                { label: 'Extra Charges', value: `₹${reports.totalExtraChargesCollected || 0}` },
                { label: 'Total Revenue', value: `₹${reports.totalRevenue || 0}` },
              ].map(stat => (
                <div key={stat.label} className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] p-3">
                  <p className="text-[10px] text-slate-400 mb-0.5 leading-tight">{stat.label}</p>
                  <p className="text-base font-bold text-white">{stat.value}</p>
                </div>
              ))}
            </div>

            {/* CSV Export with Filters */}
            <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] p-3">
              <h3 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
                <Download className="w-3.5 h-3.5 text-accent" />
                Export Packages Report
              </h3>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <label className="block text-[10px] font-medium text-slate-400 mb-1">Status</label>
                  <select
                    value={csvFilters.status}
                    onChange={e => setCsvFilters(prev => ({ ...prev, status: e.target.value }))}
                    className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent"
                  >
                    <option value="">All</option>
                    <option value="ACTIVE">Active</option>
                    <option value="EXPIRED">Expired</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-slate-400 mb-1">Package</label>
                  <select
                    value={csvFilters.packageId}
                    onChange={e => setCsvFilters(prev => ({ ...prev, packageId: e.target.value }))}
                    className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent"
                  >
                    <option value="">All Packages</option>
                    {packages.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mb-3">
                {(reportRange.from || reportRange.to)
                  ? 'Export is limited to the selected date range above.'
                  : 'Set a date range above to limit the export to a specific period.'}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadCsv}
                  disabled={downloadingCsv}
                  className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer disabled:opacity-50"
                >
                  {downloadingCsv ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Download CSV
                </button>
                {(csvFilters.status || csvFilters.packageId) && (
                  <button
                    onClick={() => setCsvFilters({ status: '', packageId: '' })}
                    className="text-xs text-slate-400 hover:text-white px-3 py-2 cursor-pointer"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            </div>
          </>
          ) : (
            <p className="text-sm text-slate-400 text-center py-16">No report data</p>
          )}
        </div>
      )}

      <NumberInputDialog
        open={!!numberDialog}
        title={numberDialog?.title || ''}
        label={numberDialog?.label || ''}
        placeholder={numberDialog?.placeholder}
        confirmLabel={numberDialog?.confirmLabel}
        variant={numberDialog?.variant}
        onConfirm={(v) => numberDialog?.onConfirm(v)}
        onCancel={() => setNumberDialog(null)}
      />
      <ConfirmDialog
        open={!!cancelPackageId}
        title="Cancel Package"
        message="Are you sure you want to cancel this package? This action cannot be undone."
        confirmLabel="Cancel Package"
        variant="danger"
        onConfirm={() => { const id = cancelPackageId; setCancelPackageId(null); if (id) handleUserAction(id, 'CANCEL'); }}
        onCancel={() => setCancelPackageId(null)}
      />

      {/* Hide scrollbar on the tab strip */}
      <style jsx>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}

/**
 * Admin card for an Available Package. Visual structure mirrors the
 * user-side PackageSection card in `src/app/packages/page.tsx` —
 * compact summary row at the top, chip row of category / pitch / ball /
 * timing / sessions in the middle, price + admin actions at the bottom.
 *
 * Keeping the visual contract identical means admins see exactly what
 * users see when browsing the same package, with the add-on of Edit /
 * Toggle controls in the card footer.
 */
function AdminPackageCard({
  pkg,
  machineDisplay,
  onEdit,
  onToggle,
  editing,
}: {
  pkg: PackageData;
  machineDisplay: (id: string | null) => string;
  onEdit: () => void;
  onToggle: () => void;
  editing: boolean;
}) {
  // Category label for the resource-aware chip. Defaults to "Bowling
  // Machine" for legacy ABCA packages where `category` is null.
  const categoryLabel = packageCategoryLabel(pkg.category);
  // The Ball Type axis only applies to bowling-machine packages — for
  // every other category the user-side card omits it entirely; we
  // mirror that omission here so the chip rows stay clean. Both leather
  // (Machine/Leather) and tennis (Machine/Tennis) machines carry the axis.
  const showBallType = !pkg.category || pkg.category === 'MACHINE';

  return (
    <div className={`bg-white/[0.04] backdrop-blur-sm rounded-xl border ${editing ? 'border-accent/30' : 'border-white/[0.08]'} hover:border-white/[0.12] transition-colors`}>
      {/* Header — name + status chip + price.
          Card uses the same `p-4` and typography as the user-side
          PackageSection so the cards are visually interchangeable. */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-semibold text-white leading-tight hover:text-accent transition-colors">{pkg.name}</h4>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${pkg.isActive ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                {pkg.isActive ? 'Active' : 'Inactive'}
              </span>
              {/* Category chip — same purple treatment as the
                  user-side card so a Cricket Nets package looks the
                  same in both surfaces. */}
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-purple-500/15 text-purple-300">
                {categoryLabel}
              </span>
            </div>
          </div>
          <span className="text-sm font-bold text-accent flex-shrink-0">₹{pkg.price}</span>
        </div>

        {/* Chip row — mirrors the user PackageSection card layout
            (Package icon · ball type · pitch · timing · sessions). */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
          {pkg.machineId && (
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Package className="w-3 h-3 text-slate-500" />
              {machineDisplay(pkg.machineId)}
            </span>
          )}
          {showBallType && pkg.ballType && (
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Zap className="w-3 h-3 text-slate-500" />
              {PACKAGE_BALL_LABEL[pkg.ballType] || pkg.ballType}
            </span>
          )}
          {pkg.machineType === 'TENNIS' && (
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Zap className="w-3 h-3 text-slate-500" />
              Tennis Ball
            </span>
          )}
          {pkg.wicketType && (
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <span className="text-slate-500">Pitch:</span>
              <span className="text-slate-300">{PACKAGE_WICKET_LABEL[pkg.wicketType] || pkg.wicketType}</span>
            </span>
          )}
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            {pkg.timingType === 'DAY' ? <Sun className="w-3 h-3 text-slate-500" /> : pkg.timingType === 'EVENING' ? <Moon className="w-3 h-3 text-slate-500" /> : <Clock className="w-3 h-3 text-slate-500" />}
            {PACKAGE_TIMING_LABEL[pkg.timingType] || pkg.timingType}
          </span>
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Calendar className="w-3 h-3 text-slate-500" />
            {pkg.totalSessions} Sessions (Per Slot: 30 Minutes) · {pkg.validityDays} Days Validity
          </span>
          {pkg._count && pkg._count.userPackages > 0 && (
            <span className="text-[10px] text-emerald-300/80 flex items-center gap-1">
              <Users className="w-3 h-3" />
              {pkg._count.userPackages} purchased
            </span>
          )}
        </div>

        {/* Footer — admin-only actions. Keeps them out of the chip row
            so the visual hierarchy still matches the user card. */}
        <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-white/[0.05]">
          {/* Delete button removed - packages are permanent records */}
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-accent bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-lg transition-colors cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
          <button
            onClick={onToggle}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-colors cursor-pointer"
            title={pkg.isActive ? 'Deactivate' : 'Activate'}
          >
            {pkg.isActive ? <ToggleRight className="w-4 h-4 text-green-400" /> : <ToggleLeft className="w-4 h-4 text-slate-500" />}
            {pkg.isActive ? 'Active' : 'Inactive'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Create / Edit form for a legacy MACHINE_PITCH package. Factored out
 * of the page so both the inline-create panel and the inline-edit
 * panel under each package row can render identical UIs. The same
 * standardized labels (PACKAGE_WICKET_OPTIONS / PACKAGE_BALL_OPTIONS /
 * PACKAGE_TIMING_OPTIONS) drive every dropdown so the admin sees
 * "Astroturf / Cement / Natural Turf", "Leather / Machine" and "Day /
 * Evening" with no extra wording.
 */
function PackageForm({
  form,
  setForm,
  centerMachines,
  isLeatherSelectedMachine,
  isTennisSelectedMachine,
  findMachineOption,
  onSubmit,
  submitLabel,
  onCancel,
  heading,
  compact,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setForm: (v: any) => void;
  centerMachines: CenterMachineRow[];
  isLeatherSelectedMachine: (key: string) => boolean;
  isTennisSelectedMachine: (key: string) => boolean;
  findMachineOption: (value: string) => CenterMachineRow | undefined;
  onSubmit: (e: React.FormEvent) => void;
  submitLabel: string;
  onCancel: () => void;
  heading: string;
  compact?: boolean;
}) {
  const wrapperBorder = compact ? 'border-accent/20' : 'border-white/[0.07]';
  return (
    <div className={`bg-white/[0.04] backdrop-blur-sm rounded-xl border ${wrapperBorder} p-5 mb-5`}>
      <h2 className="text-sm font-semibold text-white mb-3">{heading}</h2>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Package Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              required
              placeholder="e.g. Monthly 4 Sessions"
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-slate-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Machine</label>
            <select
              value={form.machineId}
              onChange={e => {
                const selected = findMachineOption(e.target.value);
                const nextMachineType = selected?.machineType.ballType === 'TENNIS' ? 'TENNIS' : 'LEATHER';
                setForm({
                  ...form,
                  machineId: e.target.value,
                  machineType: nextMachineType,
                  // Auto-clear a ball type the new machine doesn't support
                  // (e.g. switching to a tennis machine that offers Tennis
                  // only drops the now-invalid "Leather").
                  ballType: coerceBallTypeFromEffective(selected?.effectiveBallTypes, form.ballType),
                });
              }}
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent"
            >
              {centerMachines.length === 0 && (
                <option value="">Loading machines…</option>
              )}
              {centerMachines.map(m => (
                <option key={m.id} value={m.legacyMachineId || m.id} className="bg-[#1a2a40]">
                  {m.shortName || m.name}
                </option>
              ))}
            </select>
          </div>
          {/* Ball Type — options mirror the selected machine's actual
              supported ball types. Leather machines (Gravity / Yantra)
              offer Leather / Machine; tennis machines (Master 200 /
              iWinner / Leverage) support tennis only, so they offer just
              Tennis. Incompatible combinations can't be chosen. */}
          {(isLeatherSelectedMachine(form.machineId) || isTennisSelectedMachine(form.machineId)) && (
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Ball Type</label>
              <select
                value={form.ballType}
                onChange={e => setForm({ ...form, ballType: e.target.value })}
                className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent"
              >
                {ballOptionsFromEffective(findMachineOption(form.machineId)?.effectiveBallTypes).map(t => (
                  <option key={t.value} value={t.value} className="bg-[#1a2a40]">{t.label}</option>
                ))}
              </select>
            </div>
          )}
          {/* Wicket / Pitch Type */}
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Wicket Type</label>
            <div className="flex gap-2">
              {PACKAGE_WICKET_OPTIONS.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setForm({ ...form, wicketType: t.value })}
                  className={`flex-1 px-2 py-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer text-center ${form.wicketType === t.value
                      ? 'bg-accent text-primary shadow-sm'
                      : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-accent/20'
                    }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Timing</label>
            <div className="flex gap-2">
              {PACKAGE_TIMING_OPTIONS.map(t => {
                const timingLabel = t.value === 'DAY' ? PACKAGE_TIMING_DAY_LABEL : PACKAGE_TIMING_EVENING_LABEL;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setForm({ ...form, timingType: t.value })}
                    className={`flex-1 px-1 py-2.5 rounded-lg transition-all cursor-pointer text-center flex flex-col items-center justify-center ${form.timingType === t.value
                        ? 'bg-accent text-primary shadow-sm'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-accent/20'
                      }`}
                  >
                    <span className="text-xs font-semibold">{t.label}</span>
                    <span className={`text-[8px] font-medium ${form.timingType === t.value ? 'text-primary/70' : 'text-slate-500'}`}>{timingLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Total Sessions</label>
            <input
              type="number"
              min={1}
              value={form.totalSessions}
              onChange={e => setForm({ ...form, totalSessions: parseInt(e.target.value) || 1 })}
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Validity (days)</label>
            <input
              type="number"
              min={1}
              value={form.validityDays}
              onChange={e => setForm({ ...form, validityDays: parseInt(e.target.value) || 30 })}
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Price (₹)</label>
            <input
              type="number"
              min={0}
              value={form.price === '' ? '' : form.price}
              placeholder="Enter price"
              onChange={e => {
                const val = e.target.value;
                setForm({ ...form, price: val === '' ? '' : parseFloat(val) });
              }}
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent placeholder:text-slate-600"
            />
          </div>
        </div>

        {/* Extra Charge Rules */}
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-2">Extra Charge Rules (₹ per half-hour slot)</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Ball Type Upgrade - only for leather machines */}
            {isLeatherSelectedMachine(form.machineId) && (
              <div>
                <label className="block text-[10px] text-slate-500 mb-1">Ball Type Upgrade (Machine → Leather)</label>
                <input
                  type="number"
                  min={0}
                  value={form.extraChargeRules.ballTypeUpgrade}
                  onChange={e => setForm({ ...form, extraChargeRules: { ...form.extraChargeRules, ballTypeUpgrade: parseFloat(e.target.value) || 0 } })}
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent"
                />
              </div>
            )}
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Timing Upgrade (Day → Evening)</label>
              <input
                type="number"
                min={0}
                value={form.extraChargeRules.timingUpgrade}
                onChange={e => setForm({ ...form, extraChargeRules: { ...form.extraChargeRules, timingUpgrade: parseFloat(e.target.value) || 0 } })}
                className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Wicket Upgrade Paths */}
          <div className="mt-3">
            <label className="block text-[10px] text-slate-500 mb-2">Pitch Upgrade Options (₹ per half-hour slot)</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {ALL_WICKET_UPGRADE_PATHS.map(path => {
                const key = `${path.from}_TO_${path.to}`;
                const label = `${PACKAGE_WICKET_LABEL[path.from]} → ${PACKAGE_WICKET_LABEL[path.to]}`;
                return (
                  <div key={key} className="bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.06]">
                    <label className="block text-[10px] text-accent/80 font-medium mb-1">{label}</label>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500">₹</span>
                      <input
                        type="number"
                        min={0}
                        value={form.extraChargeRules.wicketTypeUpgrades?.[key] || 0}
                        onChange={e => setForm({
                          ...form,
                          extraChargeRules: {
                            ...form.extraChargeRules,
                            wicketTypeUpgrades: {
                              ...form.extraChargeRules.wicketTypeUpgrades,
                              [key]: parseFloat(e.target.value) || 0,
                            },
                          },
                        })}
                        placeholder="0"
                        className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-accent"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            {submitLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AdminPackagesPage() {
  // Center-aware split. RESOURCE_BASED centers (Toplay et al.) use a
  // category-based package model; ABCA-style centers keep the legacy
  // (machineId × machineType × ballType × wicketType) form.
  const { currentCenter, loading } = useCenter();
  if (loading || !currentCenter) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500">
        Loading…
      </div>
    );
  }
  if (currentCenter.bookingModel === 'RESOURCE_BASED') {
    // RESOURCE_BASED gets the same 4-tab UX as ABCA (Packages / User
    // Packages / Assign / Reports). The wrapper handles tabs + each
    // tab's specific UI; the catalog tab itself defers to the
    // existing ResourcePackageManagement component.
    return <ResourcePackagesPage />;
  }
  return <AdminPackagesLegacy />;
}
