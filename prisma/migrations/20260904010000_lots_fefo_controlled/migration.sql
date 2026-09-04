-- CreateEnum
CREATE TYPE "ControlledLogEntryType" AS ENUM ('DISPENSE', 'RETURN', 'DESTRUCTION');

-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN "lotNumber" TEXT,
ADD COLUMN "expiryDate" DATE;

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN "batchId" INTEGER;

-- CreateTable
CREATE TABLE "ProductBatch" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "expiryDate" DATE NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "cost" DECIMAL(10,2) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchaseItemId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItemBatch" (
    "id" SERIAL NOT NULL,
    "saleItemId" INTEGER NOT NULL,
    "batchId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "SaleItemBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlledSaleLog" (
    "id" SERIAL NOT NULL,
    "entryType" "ControlledLogEntryType" NOT NULL DEFAULT 'DISPENSE',
    "saleId" INTEGER,
    "productId" INTEGER NOT NULL,
    "batchId" INTEGER,
    "quantity" INTEGER NOT NULL,
    "prescriptionNo" TEXT,
    "doctorName" TEXT,
    "doctorLicense" TEXT,
    "patientName" TEXT,
    "soldById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlledSaleLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductBatch_productId_lotNumber_key" ON "ProductBatch"("productId", "lotNumber");

-- CreateIndex
CREATE INDEX "ProductBatch_productId_expiryDate_idx" ON "ProductBatch"("productId", "expiryDate");

-- CreateIndex
CREATE INDEX "ProductBatch_expiryDate_idx" ON "ProductBatch"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "SaleItemBatch_saleItemId_batchId_key" ON "SaleItemBatch"("saleItemId", "batchId");

-- CreateIndex
CREATE INDEX "SaleItemBatch_saleItemId_idx" ON "SaleItemBatch"("saleItemId");

-- CreateIndex
CREATE INDEX "SaleItemBatch_batchId_idx" ON "SaleItemBatch"("batchId");

-- CreateIndex
CREATE INDEX "ControlledSaleLog_productId_createdAt_idx" ON "ControlledSaleLog"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "ControlledSaleLog_createdAt_idx" ON "ControlledSaleLog"("createdAt");

-- CreateIndex
CREATE INDEX "ControlledSaleLog_prescriptionNo_idx" ON "ControlledSaleLog"("prescriptionNo");

-- CreateIndex
CREATE INDEX "ControlledSaleLog_doctorLicense_idx" ON "ControlledSaleLog"("doctorLicense");

-- CreateIndex
CREATE INDEX "ControlledSaleLog_saleId_idx" ON "ControlledSaleLog"("saleId");

-- CreateIndex
CREATE INDEX "InventoryMovement_batchId_idx" ON "InventoryMovement"("batchId");

-- CreateIndex
CREATE INDEX "Product_controlled_idx" ON "Product"("controlled");

-- AddForeignKey
ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES "PurchaseItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItemBatch" ADD CONSTRAINT "SaleItemBatch_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItemBatch" ADD CONSTRAINT "SaleItemBatch_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSaleLog" ADD CONSTRAINT "ControlledSaleLog_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSaleLog" ADD CONSTRAINT "ControlledSaleLog_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSaleLog" ADD CONSTRAINT "ControlledSaleLog_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSaleLog" ADD CONSTRAINT "ControlledSaleLog_soldById_fkey" FOREIGN KEY ("soldById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
