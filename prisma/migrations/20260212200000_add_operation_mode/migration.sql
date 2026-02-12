-- CreateEnum
CREATE TYPE "OperationMode" AS ENUM ('WITH_OPERATOR', 'SELF_OPERATE');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "operationMode" "OperationMode" NOT NULL DEFAULT 'WITH_OPERATOR';
