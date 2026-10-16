-- DropIndex
DROP INDEX "public"."SaleRefund_saleReturnId_key";

-- CreateIndex
CREATE INDEX "SalePayment_cashShiftId_idx" ON "public"."SalePayment"("cashShiftId");

-- CreateIndex
CREATE INDEX "SaleRefund_saleReturnId_idx" ON "public"."SaleRefund"("saleReturnId");
