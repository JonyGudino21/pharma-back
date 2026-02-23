/*
  Warnings:

  - Added the required column `updatedAt` to the `Supplier` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."PurchaseDeliveryStatus" AS ENUM ('PENDING', 'RECEIVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "public"."Purchase" ADD COLUMN     "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryStatus" "public"."PurchaseDeliveryStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "public"."Supplier" ADD COLUMN     "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "creditDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "Purchase_deliveryStatus_idx" ON "public"."Purchase"("deliveryStatus");

-- CreateIndex
CREATE INDEX "Purchase_invoiceNumber_idx" ON "public"."Purchase"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Supplier_email_idx" ON "public"."Supplier"("email");
