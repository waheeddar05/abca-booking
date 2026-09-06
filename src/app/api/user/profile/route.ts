import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { normalizeDisplayName } from '@/lib/display-name';
import { normalizeEmail } from '@/lib/email';

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // getAuthenticatedUser already fetched user from DB; select only the extra
    // fields not present on the auth object to avoid a redundant full query.
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        mobileNumber: true,
        mobileVerified: true,
        phonePromptDismissed: true,
        authProvider: true,
        image: true,
        isFreeUser: true,
        isSpecialUser: true,
      },
    });

    // `isSuperAdmin` comes from the auth object, not the row: it folds in
    // the SUPER_ADMIN_EMAIL bootstrap fallback that the raw column misses.
    // This is what lets client gating work for WhatsApp logins, which have
    // no NextAuth session to read a role off.
    return NextResponse.json(
      dbUser ? { ...dbUser, isSuperAdmin: user.isSuperAdmin, isStoreAdmin: user.isStoreAdmin } : null,
      {
      headers: {
        'Cache-Control': 'private, s-maxage=30, stale-while-revalidate=60',
      },
      },
    );
  } catch (error) {
    console.error('Get user profile error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const data: {
      name?: string;
      email?: string | null;
      mobileNumber?: string;
      phonePromptDismissed?: boolean;
    } = {};

    // WhatsApp login supplies no name, so this is where a nameless account
    // gets one (see `src/components/NamePrompt.tsx`). Same validator the form
    // uses, so the client can never talk the server into storing something
    // the client would itself reject.
    if (body.name !== undefined) {
      const name = normalizeDisplayName(body.name);
      if (!name.ok) {
        return NextResponse.json({ error: name.error }, { status: 400 });
      }
      data.name = name.value;
    }

    // Email is optional contact information on a WhatsApp-keyed account
    // (receipts, store enquiries), editable from /profile. Same validator
    // as the form. An empty string clears it — except on an account with
    // no mobile number, which would then be reachable by nothing at all.
    if (body.email !== undefined) {
      const email = normalizeEmail(body.email);
      if (!email.ok) {
        return NextResponse.json({ error: email.error }, { status: 400 });
      }
      if (email.value === null) {
        const current = await prisma.user.findUnique({
          where: { id: user.id },
          select: { mobileNumber: true },
        });
        if (!current?.mobileNumber) {
          return NextResponse.json(
            { error: 'Add a mobile number before removing your email.' },
            { status: 400 },
          );
        }
      } else {
        const existing = await prisma.user.findUnique({
          where: { email: email.value },
          select: { id: true },
        });
        if (existing && existing.id !== user.id) {
          return NextResponse.json(
            { error: 'This email is already linked to another account.' },
            { status: 409 },
          );
        }
      }
      data.email = email.value;
    }

    if (body.mobileNumber) {
      // Validate Indian mobile number
      const cleaned = body.mobileNumber.replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(cleaned)) {
        return NextResponse.json({ error: 'Invalid mobile number' }, { status: 400 });
      }

      // Check if number is already in use by another user
      const existing = await prisma.user.findUnique({
        where: { mobileNumber: cleaned },
      });
      if (existing && existing.id !== user.id) {
        return NextResponse.json({ error: 'This mobile number is already registered' }, { status: 409 });
      }

      data.mobileNumber = cleaned;
    }

    if (body.phonePromptDismissed !== undefined) {
      data.phonePromptDismissed = Boolean(body.phonePromptDismissed);
    }

    // An unrecognised body used to fall through to an empty update and
    // return 200, so a typo'd field looked like it had been saved.
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        mobileNumber: true,
        phonePromptDismissed: true,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Update user profile error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
