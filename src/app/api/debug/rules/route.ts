import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== 'debug-refund-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rules = await prisma.recurringSlotDiscount.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ rules });
}
