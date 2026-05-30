-- AlterTable
ALTER TABLE "UserPackage" ALTER COLUMN "activationDate" DROP NOT NULL,
ALTER COLUMN "activationDate" DROP DEFAULT,
ALTER COLUMN "expiryDate" DROP NOT NULL;
