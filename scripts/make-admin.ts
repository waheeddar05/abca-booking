import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const identifier = process.argv[2];

  if (!identifier) {
    console.error('Please provide an email or mobile number.');
    console.log('Usage: npx tsx scripts/make-admin.ts <email|mobileNumber>');
    process.exit(1);
  }

  try {
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { mobileNumber: identifier },
        ],
      },
    });

    if (!user) {
      console.error(`User with identifier "${identifier}" not found.`);
      process.exit(1);
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { role: 'ADMIN' },
    });

    console.log(`Successfully promoted user "${updatedUser.email || updatedUser.mobileNumber}" to ADMIN.`);
  } catch (error) {
    console.error('Error promoting user:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
