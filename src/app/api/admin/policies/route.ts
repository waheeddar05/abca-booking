import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getToken } from 'next-auth/jwt';
import { verifyToken } from '@/lib/jwt';

async function getSession(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token) return { role: token.role, email: token.email };

  const otpTokenStr = req.cookies.get('token')?.value;
  if (otpTokenStr) {
    const otpToken = verifyToken(otpTokenStr) as any;
    return { role: otpToken?.role, email: otpToken?.email };
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (session?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const policies = await prisma.policy.findMany();
    return NextResponse.json(policies);
  } catch (error) {
    console.error('Admin policies fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (session?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { key, value } = await req.json();

    if (!key || value === undefined) {
      return NextResponse.json({ error: 'Key and value are required' }, { status: 400 });
    }

    const policy = await prisma.policy.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });

    return NextResponse.json(policy);
  } catch (error) {
    console.error('Admin policy update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (session?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const key = searchParams.get('key');

    if (!key) {
      return NextResponse.json({ error: 'Policy key is required' }, { status: 400 });
    }

    await prisma.policy.delete({
      where: { key },
    });

    return NextResponse.json({ message: 'Policy deleted successfully' });
  } catch (error) {
    console.error('Admin policy delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
