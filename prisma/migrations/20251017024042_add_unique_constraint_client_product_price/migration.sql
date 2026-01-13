/*
  Warnings:

  - A unique constraint covering the columns `[clientId,productId]` on the table `ClientProductPrice` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE INDEX "ClientProductPrice_clientId_idx" ON "public"."ClientProductPrice"("clientId");

-- CreateIndex
CREATE INDEX "ClientProductPrice_productId_idx" ON "public"."ClientProductPrice"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProductPrice_clientId_productId_key" ON "public"."ClientProductPrice"("clientId", "productId");
