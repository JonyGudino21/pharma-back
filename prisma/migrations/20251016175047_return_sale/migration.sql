-- CreateTable
CREATE TABLE "public"."SaleReturn" (
    "id" SERIAL NOT NULL,
    "saleId" INTEGER NOT NULL,
    "processedById" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SaleReturnItem" (
    "id" SERIAL NOT NULL,
    "saleReturnId" INTEGER NOT NULL,
    "saleItemId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "SaleReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SaleRefund" (
    "id" SERIAL NOT NULL,
    "saleReturnId" INTEGER NOT NULL,
    "saleId" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "public"."PaymentMethod",
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaleRefund_saleReturnId_key" ON "public"."SaleRefund"("saleReturnId");

-- AddForeignKey
ALTER TABLE "public"."SaleReturn" ADD CONSTRAINT "SaleReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "public"."Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SaleReturn" ADD CONSTRAINT "SaleReturn_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "public"."SaleReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SaleRefund" ADD CONSTRAINT "SaleRefund_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "public"."SaleReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SaleRefund" ADD CONSTRAINT "SaleRefund_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "public"."Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
