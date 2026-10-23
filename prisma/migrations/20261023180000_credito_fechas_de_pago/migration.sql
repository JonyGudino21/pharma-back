-- Días de crédito y fechas de pago (ADR-0029). Todo opcional y aditivo.

-- AlterTable
ALTER TABLE "public"."Client" ADD COLUMN     "creditDays" INTEGER;

-- AlterTable
ALTER TABLE "public"."Purchase" ADD COLUMN     "dueDate" DATE;

-- AlterTable
ALTER TABLE "public"."Sale" ADD COLUMN     "dueDate" DATE;

-- CreateIndex
CREATE INDEX "Purchase_dueDate_idx" ON "public"."Purchase"("dueDate");

-- CreateIndex
CREATE INDEX "Sale_dueDate_idx" ON "public"."Sale"("dueDate");

-- Compras ya recibidas que aún se le deben a un proveedor con días de crédito:
-- fecha de pago = día de la compra (calendario de la farmacia) + días del
-- proveedor. Es lo que ya estaba pactado en su ficha; las ventas a clientes no
-- se tocan porque los clientes no tenían días de crédito.
UPDATE "public"."Purchase" p
SET "dueDate" = ((p."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Mexico_City')::date + s."creditDays"
FROM "public"."Supplier" s
WHERE s."id" = p."supplierId"
  AND s."creditDays" > 0
  AND p."balance" > 0
  AND p."status" <> 'CANCELLED'
  AND p."deliveryStatus" = 'RECEIVED'
  AND p."dueDate" IS NULL;
