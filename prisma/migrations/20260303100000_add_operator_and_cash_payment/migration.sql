-- AlterEnum: Add OPERATOR to UserRole
ALTER TYPE "UserRole" ADD VALUE 'OPERATOR';

-- CreateTable: OperatorAssignment
CREATE TABLE "OperatorAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "machineId" "MachineId" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: OperatorAssignment unique userId + machineId
CREATE UNIQUE INDEX "OperatorAssignment_userId_machineId_key" ON "OperatorAssignment"("userId", "machineId");

-- AddForeignKey: OperatorAssignment -> User (cascade delete)
ALTER TABLE "OperatorAssignment" ADD CONSTRAINT "OperatorAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: CashPaymentUser
CREATE TABLE "CashPaymentUser" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabledBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashPaymentUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: CashPaymentUser unique userId
CREATE UNIQUE INDEX "CashPaymentUser_userId_key" ON "CashPaymentUser"("userId");

-- AddForeignKey: CashPaymentUser -> User (cascade delete)
ALTER TABLE "CashPaymentUser" ADD CONSTRAINT "CashPaymentUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
