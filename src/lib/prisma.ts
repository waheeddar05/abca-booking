import { Prisma, PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };
const IST_TIMEZONE = 'Asia/Kolkata';
const POSTGRES_TZ_OPTION = '-c TimeZone=Asia/Kolkata';

function withPostgresTimezone(url?: string): string | undefined {
  if (!url) return undefined;

  try {
    const parsed = new URL(url);
    const currentOptions = parsed.searchParams.get('options');

    if (!currentOptions) {
      parsed.searchParams.append('options', POSTGRES_TZ_OPTION);
    } else if (!/timezone\s*=/i.test(currentOptions)) {
      parsed.searchParams.set('options', `${currentOptions} ${POSTGRES_TZ_OPTION}`);
    }

    return parsed.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}options=${encodeURIComponent(POSTGRES_TZ_OPTION)}`;
  }
}

// Ensure server process time is IST.
process.env.TZ = IST_TIMEZONE;

const prismaDatasourceUrl = withPostgresTimezone(
  process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL,
);

if (prismaDatasourceUrl && !process.env.PRISMA_DATABASE_URL) {
  process.env.PRISMA_DATABASE_URL = prismaDatasourceUrl;
}

const isDev = process.env.NODE_ENV !== 'production';

const prismaClientOptions: Prisma.PrismaClientOptions = {
  datasources: prismaDatasourceUrl ? { db: { url: prismaDatasourceUrl } } : undefined,
  log: isDev
    ? [
        { level: 'warn', emit: 'stdout' },
        { level: 'error', emit: 'stdout' },
      ]
    : [
        { level: 'warn', emit: 'stdout' },
        { level: 'error', emit: 'stdout' },
      ],
};

export const prisma =
  globalForPrisma.prisma || new PrismaClient(prismaClientOptions);

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
