-- CreateEnum
CREATE TYPE "public"."CashDrawerEventKind" AS ENUM ('MANUAL', 'TEST');

-- CreateEnum
CREATE TYPE "public"."TaxCategory" AS ENUM ('GENERAL', 'ZERO', 'EXEMPT');

-- AlterTable
ALTER TABLE "public"."Product" ADD COLUMN     "taxCategory" "public"."TaxCategory" NOT NULL DEFAULT 'ZERO';

-- AlterTable
ALTER TABLE "public"."Sale" ADD COLUMN     "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxTotal" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "public"."SaleItem" ADD COLUMN     "discountAppliedById" INTEGER,
ADD COLUMN     "discountAuthorizedById" INTEGER,
ADD COLUMN     "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "public"."AppSetting" (
    "namespace" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("namespace")
);

-- CreateTable
CREATE TABLE "public"."AppSettingAudit" (
    "id" SERIAL NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB NOT NULL,
    "changedById" INTEGER NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppSettingAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CashDrawerEvent" (
    "id" SERIAL NOT NULL,
    "kind" "public"."CashDrawerEventKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "terminal" TEXT,
    "userId" INTEGER NOT NULL,
    "shiftId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashDrawerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppSettingAudit_namespace_changedAt_idx" ON "public"."AppSettingAudit"("namespace", "changedAt");

-- CreateIndex
CREATE INDEX "CashDrawerEvent_shiftId_idx" ON "public"."CashDrawerEvent"("shiftId");

-- CreateIndex
CREATE INDEX "CashDrawerEvent_createdAt_idx" ON "public"."CashDrawerEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."SaleItem" ADD CONSTRAINT "SaleItem_discountAppliedById_fkey" FOREIGN KEY ("discountAppliedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SaleItem" ADD CONSTRAINT "SaleItem_discountAuthorizedById_fkey" FOREIGN KEY ("discountAuthorizedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AppSetting" ADD CONSTRAINT "AppSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AppSettingAudit" ADD CONSTRAINT "AppSettingAudit_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CashDrawerEvent" ADD CONSTRAINT "CashDrawerEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CashDrawerEvent" ADD CONSTRAINT "CashDrawerEvent_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "public"."CashShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
