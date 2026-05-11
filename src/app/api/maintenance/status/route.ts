import { NextResponse } from 'next/server';
import { getMaintenanceSettings } from '@/lib/maintenance';

// Public endpoint - used by middleware to check maintenance status
// No auth required since it only returns whether maintenance is on and the message
export async function GET() {
    // Env-var kill switch: if MAINTENANCE_MODE is on, short-circuit without
  // touching the DB. This matches the middleware behavior and prevents a
  // refresh loop on /maintenance when the DB is unreachable: if we hit the
  // DB here and it throws, the catch returns { enabled: false }, the
  // maintenance page treats that as "maintenance over" and redirects to
  // /slots, which middleware rewrites back to /maintenance — every second.
  if (process.env.MAINTENANCE_MODE === 'true') {
        return NextResponse.json({
                enabled: true,
                message: 'We are currently undergoing scheduled maintenance. Please check back soon.',
                allowAllAdmins: false,
                allowedEmails: [],
        });
  }

  try {
        const settings = await getMaintenanceSettings();

      return NextResponse.json({
              enabled: settings.enabled,
              message: settings.message,
              allowAllAdmins: settings.allowAllAdmins,
              allowedEmails: settings.allowedEmails,
      });
  } catch (error) {
        console.error('Maintenance status check error:', error);
        // On error, assume maintenance is off to avoid locking everyone out
      return NextResponse.json({ enabled: false });
  }
}
