-- DropIndex
DROP INDEX "public"."Sale_userId_flowStatus_createdAt_idx";

-- CreateIndex
CREATE INDEX "Sale_userId_flowStatus_createdAt_idx" ON "public"."Sale"("userId", "flowStatus", "createdAt");

-- RenameIndex
ALTER INDEX "public"."ClientProductPriceHistory_client_product_idx" RENAME TO "ClientProductPriceHistory_clientId_productId_idx";
