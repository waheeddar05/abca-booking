import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Cleanup groups define what gets deleted and in what order (respecting FK constraints)
const CLEANUP_GROUPS: Record<
  string,
  {
    label: string;
    description: string;
    steps: { model: string; label: string }[];
  }
> = {
  bookings: {
    label: 'Bookings & Related',
    description:
      'Deletes all refunds, package-bookings, and bookings. Payments are kept.',
    steps: [
      { model: 'refund', label: 'Refunds' },
      { model: 'packageBooking', label: 'Package Bookings' },
      { model: 'booking', label: 'Bookings' },
    ],
  },
  payments: {
    label: 'Payments & Refunds',
    description:
      'Deletes all refunds and payment records. Bookings are kept but lose payment references.',
    steps: [
      { model: 'refund', label: 'Refunds' },
      { model: 'payment', label: 'Payments' },
    ],
  },
  packages: {
    label: 'Packages & User Packages',
    description:
      'Deletes audit logs, package-bookings, user-packages, and package definitions.',
    steps: [
      { model: 'packageAuditLog', label: 'Package Audit Logs' },
      { model: 'packageBooking', label: 'Package Bookings' },
      { model: 'userPackage', label: 'User Packages' },
      { model: 'package', label: 'Packages' },
    ],
  },
  wallets: {
    label: 'Wallets & Transactions',
    description: 'Deletes all wallet transactions and wallets.',
    steps: [
      { model: 'walletTransaction', label: 'Wallet Transactions' },
      { model: 'wallet', label: 'Wallets' },
    ],
  },
  notifications: {
    label: 'Notifications',
    description: 'Deletes all in-app and WhatsApp notifications.',
    steps: [{ model: 'notification', label: 'Notifications' }],
  },
  otps: {
    label: 'OTPs',
    description: 'Deletes all OTP records.',
    steps: [{ model: 'otp', label: 'OTPs' }],
  },
  slots: {
    label: 'Slots',
    description: 'Deletes all slot definitions.',
    steps: [{ model: 'slot', label: 'Slots' }],
  },
  blockedSlots: {
    label: 'Blocked Slots',
    description: 'Deletes all blocked slot records.',
    steps: [{ model: 'blockedSlot', label: 'Blocked Slots' }],
  },
  operatorData: {
    label: 'Operator Data',
    description:
      'Deletes operator assignments and cash-payment-user records.',
    steps: [
      { model: 'operatorAssignment', label: 'Operator Assignments' },
      { model: 'cashPaymentUser', label: 'Cash Payment Users' },
    ],
  },
  recurringDiscounts: {
    label: 'Recurring Slot Discounts',
    description: 'Deletes all recurring slot discount rules.',
    steps: [
      { model: 'recurringSlotDiscount', label: 'Recurring Slot Discounts' },
    ],
  },
  policies: {
    label: 'Policies',
    description:
      'Deletes all policy key-value pairs (pricing config, feature flags, etc.).',
    steps: [{ model: 'policy', label: 'Policies' }],
  },
};

// Map model key to prisma delegate
function getDelegate(model: string) {
  const map: Record<string, any> = {
    refund: prisma.refund,
    packageBooking: prisma.packageBooking,
    booking: prisma.booking,
    payment: prisma.payment,
    packageAuditLog: prisma.packageAuditLog,
    userPackage: prisma.userPackage,
    package: prisma.package,
    walletTransaction: prisma.walletTransaction,
    wallet: prisma.wallet,
    notification: prisma.notification,
    otp: prisma.otp,
    slot: prisma.slot,
    blockedSlot: prisma.blockedSlot,
    operatorAssignment: prisma.operatorAssignment,
    cashPaymentUser: prisma.cashPaymentUser,
    recurringSlotDiscount: prisma.recurringSlotDiscount,
    policy: prisma.policy,
  };
  return map[model];
}

// GET — return available groups with current row counts
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user || !user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const groups: Record<
    string,
    { label: string; description: string; totalRows: number; steps: { model: string; label: string; count: number }[] }
  > = {};

  for (const [key, group] of Object.entries(CLEANUP_GROUPS)) {
    let totalRows = 0;
    const steps: { model: string; label: string; count: number }[] = [];
    for (const step of group.steps) {
      const delegate = getDelegate(step.model);
      const count = delegate ? await delegate.count() : 0;
      totalRows += count;
      steps.push({ model: step.model, label: step.label, count });
    }
    groups[key] = {
      label: group.label,
      description: group.description,
      totalRows,
      steps,
    };
  }

  return NextResponse.json({ groups });
}

// POST — perform cleanup for selected groups
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user || !user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const selectedGroups: string[] = body.groups;

  if (!Array.isArray(selectedGroups) || selectedGroups.length === 0) {
    return NextResponse.json(
      { error: 'No groups selected' },
      { status: 400 }
    );
  }

  // Validate all group keys
  for (const g of selectedGroups) {
    if (!CLEANUP_GROUPS[g]) {
      return NextResponse.json(
        { error: `Unknown group: ${g}` },
        { status: 400 }
      );
    }
  }

  // Build ordered deletion steps — deduplicate models across selected groups
  // while preserving correct FK order
  const orderedSteps: { model: string; label: string; groupKey: string }[] = [];
  const seen = new Set<string>();

  // Process groups in a safe order: bookings first (clears FKs), then payments, packages, etc.
  const safeOrder = [
    'bookings',
    'payments',
    'packages',
    'wallets',
    'notifications',
    'otps',
    'slots',
    'blockedSlots',
    'operatorData',
    'recurringDiscounts',
    'policies',
  ];

  for (const groupKey of safeOrder) {
    if (!selectedGroups.includes(groupKey)) continue;
    const group = CLEANUP_GROUPS[groupKey];
    for (const step of group.steps) {
      if (!seen.has(step.model)) {
        seen.add(step.model);
        orderedSteps.push({ ...step, groupKey });
      }
    }
  }

  // Execute deletions inside a transaction
  const results: { model: string; label: string; deleted: number }[] = [];

  await prisma.$transaction(async (tx: any) => {
    for (const step of orderedSteps) {
      const delegate = tx[step.model];
      if (!delegate) continue;
      const result = await delegate.deleteMany({});
      results.push({
        model: step.model,
        label: step.label,
        deleted: result.count,
      });
    }
  });

  return NextResponse.json({
    success: true,
    results,
    totalDeleted: results.reduce((sum, r) => sum + r.deleted, 0),
  });
}
