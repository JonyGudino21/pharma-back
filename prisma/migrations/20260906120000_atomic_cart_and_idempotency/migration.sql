-- FASE 1 · Carrito atómico e idempotencia de cobro
--
-- Esta migración es DESTRUCTIVA DE FORMA CONTROLADA: consolida líneas de venta
-- duplicadas antes de imponer la restricción única. Sin el paso 1, el ALTER
-- fallaría en cualquier base que ya tenga el defecto materializado.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CONSOLIDACIÓN DE LÍNEAS DUPLICADAS
--
-- El bug de addItem (read-modify-write) podía crear varias filas de SaleItem
-- para el mismo producto dentro de una venta. Se fusionan en la fila más
-- antigua sumando cantidades y subtotales, y se reapuntan las dependencias
-- (SaleItemBatch y SaleReturnItem) antes de borrar las sobrantes.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.a Fila canónica (la de menor id) por cada par (saleId, productId) duplicado
CREATE TEMP TABLE "_dup_sale_items" AS
SELECT
  MIN(si."id")            AS "keepId",
  si."saleId",
  si."productId",
  SUM(si."quantity")      AS "totalQuantity",
  SUM(si."subtotal")      AS "totalSubtotal"
FROM "public"."SaleItem" si
GROUP BY si."saleId", si."productId"
HAVING COUNT(*) > 1;

-- 1.b Mapa: id sobrante -> id canónico
CREATE TEMP TABLE "_dup_map" AS
SELECT si."id" AS "dropId", d."keepId"
FROM "public"."SaleItem" si
JOIN "_dup_sale_items" d
  ON si."saleId" = d."saleId"
 AND si."productId" = d."productId"
WHERE si."id" <> d."keepId";

-- 1.c Reapuntar los lotes despachados.
-- SaleItemBatch tiene UNIQUE(saleItemId, batchId): si la fila canónica ya
-- tiene ese lote, se suman las cantidades en lugar de reapuntar.
UPDATE "public"."SaleItemBatch" sib
SET "quantity" = sib."quantity" + dup."quantity"
FROM "_dup_map" m
JOIN "public"."SaleItemBatch" dup ON dup."saleItemId" = m."dropId"
WHERE sib."saleItemId" = m."keepId"
  AND sib."batchId" = dup."batchId";

DELETE FROM "public"."SaleItemBatch" sib
USING "_dup_map" m, "public"."SaleItemBatch" keep
WHERE sib."saleItemId" = m."dropId"
  AND keep."saleItemId" = m."keepId"
  AND keep."batchId" = sib."batchId";

UPDATE "public"."SaleItemBatch" sib
SET "saleItemId" = m."keepId"
FROM "_dup_map" m
WHERE sib."saleItemId" = m."dropId";

-- 1.d Reapuntar las devoluciones para no perder el histórico acumulado
UPDATE "public"."SaleReturnItem" sri
SET "saleItemId" = m."keepId"
FROM "_dup_map" m
WHERE sri."saleItemId" = m."dropId";

-- 1.e Consolidar cantidad y subtotal en la fila canónica
UPDATE "public"."SaleItem" si
SET "quantity" = d."totalQuantity",
    "subtotal" = d."totalSubtotal"
FROM "_dup_sale_items" d
WHERE si."id" = d."keepId";

-- 1.f Eliminar las filas sobrantes
DELETE FROM "public"."SaleItem" si
USING "_dup_map" m
WHERE si."id" = m."dropId";

DROP TABLE "_dup_map";
DROP TABLE "_dup_sale_items";

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RESTRICCIÓN ÚNICA: una línea por producto y venta
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "SaleItem_saleId_productId_key"
  ON "public"."SaleItem"("saleId", "productId");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. IDEMPOTENCIA DE COBRO
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "public"."SalePayment" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "SalePayment_idempotencyKey_key"
  ON "public"."SalePayment"("idempotencyKey");
