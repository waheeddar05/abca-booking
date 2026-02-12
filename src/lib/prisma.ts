import { Prisma, PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const prismaClientOptions: Prisma.PrismaClientOptions = {
  log: [
    { level: 'query', emit: 'event' },
    { level: 'info', emit: 'stdout' },
    { level: 'warn', emit: 'stdout' },
    { level: 'error', emit: 'stdout' },
  ],
};

export const prisma =
  globalForPrisma.prisma || new PrismaClient(prismaClientOptions);

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Bind query logging
// @ts-ignore
prisma.$on('query', (e: any) => {
  console.log('Query: ' + e.query);
  console.log('Params: ' + e.params);
  console.log('Duration: ' + e.duration + 'ms');
});

// Explicit connection and table check
async function checkDatabaseConnection() {
  try {
    console.log('--- Database Startup Check ---');
    console.log('Checking database connection...');
    
    // Test connection
    await prisma.$connect();
    console.log('✅ Database connection successful.');

    // Check for required tables
    console.log('Verifying required tables...');
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'
    `;
    
    const existingTables = tables.map(t => t.tablename.toLowerCase());
    const requiredTables = ['user', 'policy', 'otp', 'booking'];
    const missingTables = requiredTables.filter(t => !existingTables.includes(t));

    if (missingTables.length > 0) {
      console.error(`❌ Missing tables: ${missingTables.join(', ')}`);
      console.error('Initial database tables are missing in the current database.');
      console.error('Migration should have run during deployment via postinstall script.');
      console.error('Please check your Vercel build logs for migration errors.');

      if (process.env.NODE_ENV === 'production') {
        console.error('Failing fast to avoid inconsistent application state.');
        process.exit(1);
      }
    } else {
      console.log('✅ All required tables are present.');
    }

    // Check for optional tables and columns from newer migrations
    const optionalTables = ['slot'];
    const missingOptional = optionalTables.filter(t => !existingTables.includes(t));
    if (missingOptional.length > 0) {
      console.warn(`⚠️  Optional tables missing: ${missingOptional.join(', ')}`);
      console.warn('Some features (slot management, pricing) will be unavailable.');
      console.warn('Run "npx prisma migrate deploy" to apply pending migrations.');
    }

    // Check for pricing columns on Booking table
    try {
      const columns = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Booking'
      `;
      const columnNames = columns.map(c => c.column_name);
      const pricingColumns = ['price', 'originalPrice', 'discountAmount', 'discountType', 'pitchType', 'extraCharge'];
      const missingColumns = pricingColumns.filter(c => !columnNames.includes(c));
      if (missingColumns.length > 0) {
        console.warn(`⚠️  Missing Booking columns: ${missingColumns.join(', ')}`);
        console.warn('Pricing features will be degraded. Run "npx prisma migrate deploy" to apply pending migrations.');
      }
    } catch {
      // Non-critical check
    }

    console.log('------------------------------');
  } catch (error) {
    console.error('❌ Database startup check failed:');
    console.error(error);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
}

// Execute check but don't block main thread in dev (Next.js hot reloading might trigger this often)
if (process.env.NODE_ENV === 'production' || (typeof window === 'undefined' && !globalForPrisma.prisma)) {
  checkDatabaseConnection();
}
