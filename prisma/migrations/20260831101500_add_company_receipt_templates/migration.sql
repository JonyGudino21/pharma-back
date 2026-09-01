-- CreateEnum
CREATE TYPE "PrintChannel" AS ENUM ('THERMAL', 'BROWSER');

-- CreateTable
CREATE TABLE "Company" (
    "id" SERIAL NOT NULL,
    "singletonKey" TEXT NOT NULL DEFAULT 'default',
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL,
    "rfc" TEXT NOT NULL DEFAULT '',
    "fiscalRegime" TEXT,
    "address" TEXT NOT NULL DEFAULT '',
    "phone" TEXT,
    "email" TEXT,
    "logoUrl" TEXT,
    "ticketFooter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptTemplate" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "paperWidthMm" INTEGER NOT NULL DEFAULT 58,
    "showLogo" BOOLEAN NOT NULL DEFAULT true,
    "showTaxId" BOOLEAN NOT NULL DEFAULT true,
    "showAddress" BOOLEAN NOT NULL DEFAULT true,
    "showPhone" BOOLEAN NOT NULL DEFAULT true,
    "fontScale" INTEGER NOT NULL DEFAULT 1,
    "layout" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptTemplate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReceiptTemplate_paperWidthMm_check" CHECK ("paperWidthMm" IN (58, 80)),
    CONSTRAINT "ReceiptTemplate_fontScale_check" CHECK ("fontScale" IN (1, 2))
);

-- CreateTable
CREATE TABLE "SaleReceiptPrint" (
    "id" SERIAL NOT NULL,
    "saleId" INTEGER NOT NULL,
    "printedById" INTEGER NOT NULL,
    "templateId" INTEGER,
    "copyNumber" INTEGER NOT NULL,
    "channel" "PrintChannel" NOT NULL,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReceiptPrint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Company_singletonKey_key" ON "Company"("singletonKey");

CREATE INDEX "ReceiptTemplate_companyId_isDefault_idx" ON "ReceiptTemplate"("companyId", "isDefault");
CREATE INDEX "ReceiptTemplate_companyId_isActive_idx" ON "ReceiptTemplate"("companyId", "isActive");

CREATE UNIQUE INDEX "SaleReceiptPrint_saleId_copyNumber_key" ON "SaleReceiptPrint"("saleId", "copyNumber");
CREATE INDEX "SaleReceiptPrint_saleId_idx" ON "SaleReceiptPrint"("saleId");
CREATE INDEX "SaleReceiptPrint_printedById_idx" ON "SaleReceiptPrint"("printedById");

ALTER TABLE "ReceiptTemplate" ADD CONSTRAINT "ReceiptTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaleReceiptPrint" ADD CONSTRAINT "SaleReceiptPrint_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleReceiptPrint" ADD CONSTRAINT "SaleReceiptPrint_printedById_fkey" FOREIGN KEY ("printedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleReceiptPrint" ADD CONSTRAINT "SaleReceiptPrint_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ReceiptTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ficha fiscal inicial: una farmacia, una plantilla de 58 mm. El GET /company
-- es idempotente y no duplica esta fila aunque el seed ya exista.
INSERT INTO "Company" ("singletonKey", "legalName", "tradeName", "rfc", "address", "ticketFooter", "updatedAt")
VALUES (
    'default',
    'Mi Farmacia',
    'Mi Farmacia',
    '',
    '',
    'Conserve su ticket. Para devoluciones presente este comprobante.',
    CURRENT_TIMESTAMP
);

INSERT INTO "ReceiptTemplate" ("companyId", "name", "paperWidthMm", "layout", "isDefault", "isActive", "updatedAt")
SELECT
    c.id,
    'Térmica 58 mm',
    58,
    '{"blocks":["header","meta","items","totals","payments","footer"]}'::jsonb,
    true,
    true,
    CURRENT_TIMESTAMP
FROM "Company" c
WHERE c."singletonKey" = 'default';
