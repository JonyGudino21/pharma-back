-- CreateEnum
CREATE TYPE "public"."SalePriceSource" AS ENUM ('LIST', 'CLIENT', 'MANUAL');

-- AlterTable
ALTER TABLE "public"."ClientProductPrice" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "public"."ClientProductPriceHistory" ADD COLUMN     "previousPrice" DECIMAL(10,2),
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "saleId" INTEGER;

-- AlterTable
ALTER TABLE "public"."SaleItem" ADD COLUMN     "listPrice" DECIMAL(10,2),
ADD COLUMN     "priceChangedById" INTEGER,
ADD COLUMN     "priceReason" TEXT,
ADD COLUMN     "priceSource" "public"."SalePriceSource" NOT NULL DEFAULT 'LIST';

-- AddForeignKey
ALTER TABLE "public"."SaleItem" ADD CONSTRAINT "SaleItem_priceChangedById_fkey" FOREIGN KEY ("priceChangedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClientProductPriceHistory" ADD CONSTRAINT "ClientProductPriceHistory_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "public"."Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- CORRECCIÓN DE DATOS (ADR-0025)
--
-- Hasta esta versión NO existía forma de asignar un precio especial: el cierre
-- de cada venta con cliente copiaba el precio de LISTA de cada producto como
-- "precio especial" de ese cliente. Si después subía el precio de lista, el
-- cliente seguía pagando el viejo sin que nadie lo hubiera decidido.
--
-- Ninguna fila actual fue negociada: todas se desactivan (NO se borran) y se
-- cierra su historial con el motivo. Desde ahora un precio especial sólo nace
-- cuando alguien lo captura en caja o en la ficha del cliente.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "public"."ClientProductPriceHistory" h
SET "endDate" = CURRENT_TIMESTAMP,
    "reason"  = COALESCE(h."reason", 'Desactivado por ADR-0025: precio de lista capturado automáticamente al cerrar una venta')
WHERE h."endDate" IS NULL
  AND EXISTS (
    SELECT 1 FROM "public"."ClientProductPrice" p
    WHERE p."clientId" = h."clientId" AND p."productId" = h."productId" AND p."isActive"
  );

UPDATE "public"."ClientProductPrice" SET "isActive" = false WHERE "isActive";

-- Líneas de ventas en borrador: referencia de precio de lista para la caja.
UPDATE "public"."SaleItem" si
SET "listPrice" = pr."price"
FROM "public"."Product" pr, "public"."Sale" s
WHERE si."productId" = pr."id" AND si."saleId" = s."id" AND s."flowStatus" = 'DRAFT';
