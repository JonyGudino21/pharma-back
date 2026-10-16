-- Nota de remision: la bitacora de impresiones distingue el documento (ticket / nota).
-- Seguro con datos existentes: el DROP INDEX sustituye la unicidad (saleId, copyNumber)
-- por una MAS AMPLIA (saleId, document, copyNumber); toda fila vigente es TICKET por default.

-- CreateEnum
CREATE TYPE "public"."PrintDocument" AS ENUM ('TICKET', 'REMISSION');

-- DropIndex
DROP INDEX "public"."SaleReceiptPrint_saleId_copyNumber_key";

-- AlterTable
ALTER TABLE "public"."SaleReceiptPrint" ADD COLUMN     "document" "public"."PrintDocument" NOT NULL DEFAULT 'TICKET';

-- CreateIndex
CREATE UNIQUE INDEX "SaleReceiptPrint_saleId_document_copyNumber_key" ON "public"."SaleReceiptPrint"("saleId", "document", "copyNumber");

