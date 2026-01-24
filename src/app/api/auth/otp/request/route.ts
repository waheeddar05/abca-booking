import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { sendSMS } from '@/lib/sms';

export async function POST(req: NextRequest) {
  return NextResponse.json(
    { error: 'Mobile number login is temporarily disabled. Please use Google Login.' },
    { status: 403 }
  );
}

export async function POST_DISABLED(req: NextRequest) {
  try {
    const { mobileNumber } = await req.json();

    if (!mobileNumber) {
      return NextResponse.json({ error: 'Mobile number is required' }, { status: 400 });
    }

    // Generate 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + (Number(process.env.OTP_TTL_MINUTES) || 10) * 60000);

    let user = await prisma.user.findUnique({
      where: { mobileNumber },
    });

    if (!user) {
      const isInitialAdmin = mobileNumber === process.env.INITIAL_ADMIN_MOBILE;
      user = await prisma.user.create({
        data: {
          mobileNumber,
          authProvider: 'OTP',
          role: isInitialAdmin ? 'ADMIN' : 'USER',
        },
      });
    }

    await prisma.otp.create({
      data: {
        userId: user.id,
        codeHash: hashedOtp,
        expiresAt,
      },
    });

    // Send OTP via SMS
    const smsResult = await sendSMS(mobileNumber, otp);
    
    const message = `[DEBUG] OTP for ${mobileNumber}: ${otp}`;
    console.log(message);
    if (!smsResult.success) {
      console.warn('SMS sending failed, but continuing for debug purposes in console.');
    }

    return NextResponse.json({ 
      message: 'OTP sent successfully',
      debugMessage: process.env.NODE_ENV === 'development' ? message : undefined 
    });
  } catch (error) {
    console.error('OTP request error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
