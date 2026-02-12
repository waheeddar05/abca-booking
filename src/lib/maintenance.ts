import { prisma } from '@/lib/prisma';

export const SUPER_ADMIN_EMAIL = 'waheeddar8@gmail.com';

// Policy keys for maintenance mode
export const MAINTENANCE_KEYS = {
  ENABLED: 'MAINTENANCE_MODE_ENABLED',
  MESSAGE: 'MAINTENANCE_MODE_MESSAGE',
  ALLOW_ALL_ADMINS: 'MAINTENANCE_ALLOW_ALL_ADMINS',
  ALLOWED_EMAILS: 'MAINTENANCE_ALLOWED_EMAILS',
} as const;

export interface MaintenanceSettings {
  enabled: boolean;
  message: string;
  allowAllAdmins: boolean;
  allowedEmails: string[]; // specific emails that are allowed access
}

const DEFAULT_SETTINGS: MaintenanceSettings = {
  enabled: false,
  message: 'We are currently undergoing scheduled maintenance. Please check back soon.',
  allowAllAdmins: false,
  allowedEmails: [],
};

export async function getMaintenanceSettings(): Promise<MaintenanceSettings> {
  const policies = await prisma.policy.findMany({
    where: {
      key: { in: Object.values(MAINTENANCE_KEYS) },
    },
  });

  const map = new Map(policies.map(p => [p.key, p.value]));

  return {
    enabled: map.get(MAINTENANCE_KEYS.ENABLED) === 'true',
    message: map.get(MAINTENANCE_KEYS.MESSAGE) || DEFAULT_SETTINGS.message,
    allowAllAdmins: map.get(MAINTENANCE_KEYS.ALLOW_ALL_ADMINS) === 'true',
    allowedEmails: parseJsonArray(map.get(MAINTENANCE_KEYS.ALLOWED_EMAILS)),
  };
}

export async function saveMaintenanceSettings(settings: MaintenanceSettings): Promise<void> {
  const entries: { key: string; value: string }[] = [
    { key: MAINTENANCE_KEYS.ENABLED, value: String(settings.enabled) },
    { key: MAINTENANCE_KEYS.MESSAGE, value: settings.message },
    { key: MAINTENANCE_KEYS.ALLOW_ALL_ADMINS, value: String(settings.allowAllAdmins) },
    { key: MAINTENANCE_KEYS.ALLOWED_EMAILS, value: JSON.stringify(settings.allowedEmails) },
  ];

  await prisma.$transaction(
    entries.map(({ key, value }) =>
      prisma.policy.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    )
  );
}

/**
 * Check if a user (by email and role) is allowed access during maintenance mode.
 * Super admin always has access.
 */
export function isUserAllowedDuringMaintenance(
  settings: MaintenanceSettings,
  email: string | null | undefined,
  role: string | null | undefined
): boolean {
  if (!settings.enabled) return true;

  // Super admin always has access
  if (email === SUPER_ADMIN_EMAIL) return true;

  // If all admins are allowed and user is admin
  if (settings.allowAllAdmins && role === 'ADMIN') return true;

  // Check if this specific email is in the allowed list
  if (email && settings.allowedEmails.includes(email)) return true;

  return false;
}

function parseJsonArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
