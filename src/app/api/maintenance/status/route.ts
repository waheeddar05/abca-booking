import { NextResponse } from 'next/server';
import { getMaintenanceSettings } from '@/lib/maintenance';

// Public endpoint - used by middleware to check maintenance status
// No auth required since it only returns whether maintenance is on and the message
export async function GET() {
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
