/*
  Warnings:

  - Added the required column `costAtSale` to the `SaleItem` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID');

-- CreateEnum
CREATE TYPE "public"."MovementType" AS ENUM ('SALE', 'PURCHASE', 'RETURN_IN', 'RETURN_OUT', 'ADJUSTMENT', 'TRANSFER');

-- CreateEnum
CREATE TYPE "public"."ShiftStatus" AS ENUM ('OPEN', 'CLOSED', 'AUDIT_REQUIRED');

-- CreateEnum
CREATE TYPE "public"."CashTransactionType" AS ENUM ('SALE_INCOME', 'CREDIT_PAYMENT', 'MANUAL_ADD', 'MANUAL_WITHDRAW', 'EXPENSE');

-- AlterTable
ALTER TABLE "public"."Client" ADD COLUMN     "creditLimit" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "currentDebt" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "hasCredit" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."Sale" ADD COLUMN     "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "cashShiftId" INTEGER,
ADD COLUMN     "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "paymentStatus" "public"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "profit" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalCost" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "public"."SaleItem" ADD COLUMN     "costAtSale" DECIMAL(10,2) NOT NULL;

-- AlterTable
ALTER TABLE "public"."SalePayment" ADD COLUMN     "cashShiftId" INTEGER,
ADD COLUMN     "isDeposit" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "public"."CashShift" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "initialAmount" DECIMAL(12,2) NOT NULL,
    "expectedAmount" DECIMAL(12,2),
    "realAmount" DECIMAL(12,2),
    "difference" DECIMAL(12,2),
    "status" "public"."ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CashTransaction" (
    "id" SERIAL NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "type" "public"."CashTransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceId" INTEGER,
    "relatedTable" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER NOT NULL,

    CONSTRAINT "CashTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryMovement" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "type" "public"."MovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(10,2) NOT NULL,
    "totalCost" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER NOT NULL,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashShift_userId_idx" ON "public"."CashShift"("userId");

-- CreateIndex
CREATE INDEX "CashShift_status_idx" ON "public"."CashShift"("status");

-- CreateIndex
CREATE INDEX "CashShift_openedAt_idx" ON "public"."CashShift"("openedAt");

-- CreateIndex
CREATE INDEX "CashTransaction_shiftId_idx" ON "public"."CashTransaction"("shiftId");

-- CreateIndex
CREATE INDEX "InventoryMovement_productId_idx" ON "public"."InventoryMovement"("productId");

-- CreateIndex
CREATE INDEX "InventoryMovement_createdAt_idx" ON "public"."InventoryMovement"("createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_type_idx" ON "public"."InventoryMovement"("type");

-- AddForeignKey
ALTER TABLE "public"."Sale" ADD CONSTRAINT "Sale_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "public"."CashShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CashShift" ADD CONSTRAINT "CashShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CashTransaction" ADD CONSTRAINT "CashTransaction_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "public"."CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryMovement" ADD CONSTRAINT "InventoryMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
