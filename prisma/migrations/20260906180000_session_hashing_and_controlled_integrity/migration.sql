-- FASE 2 · Hashing de sesiones e integridad del libro de controlados
--
-- ⚠️  ESTA MIGRACIÓN CIERRA TODAS LAS SESIONES ACTIVAS.
--     sha256 no es reversible, así que los refresh tokens existentes no se
--     pueden convertir a su huella. Se descartan y todos los usuarios vuelven a
--     iniciar sesión UNA vez. Es un coste aceptable y anunciable; conservar los
--     tokens en claro no lo es.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. REFRESH TOKENS HASHEADOS (hallazgo C-3, crítico)
-- ═════════════════════════════════════════════════════════════════════════════

-- 1.a Descartar las sesiones vivas: sus tokens en claro no son convertibles.
DELETE FROM "public"."UserToken";

-- 1.b Sustituir la columna. Se elimina primero el índice redundante que existía
--     sobre una columna ya UNIQUE (duplicaba el B-tree sin aportar nada).
DROP INDEX IF EXISTS "public"."UserToken_token_idx";
ALTER TABLE "public"."UserToken" DROP CONSTRAINT IF EXISTS "UserToken_token_key";
ALTER TABLE "public"."UserToken" DROP COLUMN "token";

ALTER TABLE "public"."UserToken" ADD COLUMN "tokenHash" TEXT NOT NULL;
CREATE UNIQUE INDEX "UserToken_tokenHash_key" ON "public"."UserToken"("tokenHash");

-- 1.c Índice para la purga periódica de expirados (deleteExpired).
CREATE INDEX "UserToken_expiresAt_idx" ON "public"."UserToken"("expiresAt");

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. LIBRO DE CONTROLADOS: COMPLETITUD (hallazgo C-6, crítico · COFEPRIS)
--
-- Los cuatro campos de la receta son opcionales en el modelo porque un asiento
-- de DEVOLUCIÓN o DESTRUCCIÓN legítimamente no los tiene. Pero un asiento de
-- DISPENSACIÓN sin receta, médico, cédula y paciente es un registro NO CONFORME,
-- y hasta ahora nada en la base lo impedía: la única defensa vivía en la capa de
-- aplicación, donde un cambio de código o una ruta nueva podía saltársela.
-- ═════════════════════════════════════════════════════════════════════════════

-- 2.a La restricción se añade como NOT VALID a propósito.
--
--     NOT VALID significa: se exige en TODO asiento nuevo o modificado, pero no
--     se valida el histórico. Es la decisión correcta aquí por tres razones:
--
--     1. Los asientos históricos incompletos son un HECHO. No tenemos los datos
--        de receta que faltan y no vamos a inventarlos.
--     2. El libro es append-only: reclasificarlos o borrarlos para "limpiar" la
--        restricción sería falsear un registro sanitario, peor que el defecto.
--     3. Un ALTER TYPE que añadiera un valor de enum tampoco serviría:
--        PostgreSQL no permite usar un valor de enum nuevo dentro de la misma
--        transacción en que se creó, y Prisma corre la migración en una.
--
--     A partir de aquí es IMPOSIBLE registrar una dispensación incompleta.
--
--     ANTES DE DESPLEGAR, audita cuántos asientos históricos quedan fuera:
--       SELECT COUNT(*) FROM "ControlledSaleLog"
--       WHERE "entryType" = 'DISPENSE'
--         AND ("prescriptionNo" IS NULL OR "doctorName" IS NULL
--           OR "doctorLicense" IS NULL OR "patientName" IS NULL);
--     Si el resultado es 0, puedes validarla del todo con:
--       ALTER TABLE "ControlledSaleLog"
--         VALIDATE CONSTRAINT "controlled_dispense_requires_prescription";
ALTER TABLE "public"."ControlledSaleLog"
  ADD CONSTRAINT "controlled_dispense_requires_prescription" CHECK (
    "entryType" <> 'DISPENSE' OR (
      "prescriptionNo" IS NOT NULL AND "doctorName"  IS NOT NULL AND
      "doctorLicense"  IS NOT NULL AND "patientName" IS NOT NULL
    )
  ) NOT VALID;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. LIBRO DE CONTROLADOS: INMUTABILIDAD (hallazgo M-2)
--
-- El libro debe ser append-only. Hasta ahora eso era una convención del equipo:
-- nada impedía un UPDATE o un DELETE, ni desde el código ni desde una consola
-- de base de datos. Se impone en el motor, que es el único lugar donde la
-- garantía sobrevive a cualquier consumidor futuro.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION "public"."controlled_log_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'El libro de medicamentos controlados es inmutable (COFEPRIS): la operacion % no esta permitida. Registre un asiento de ajuste en su lugar.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS "controlled_log_no_update" ON "public"."ControlledSaleLog";
CREATE TRIGGER "controlled_log_no_update"
  BEFORE UPDATE ON "public"."ControlledSaleLog"
  FOR EACH ROW EXECUTE FUNCTION "public"."controlled_log_immutable"();

DROP TRIGGER IF EXISTS "controlled_log_no_delete" ON "public"."ControlledSaleLog";
CREATE TRIGGER "controlled_log_no_delete"
  BEFORE DELETE ON "public"."ControlledSaleLog"
  FOR EACH ROW EXECUTE FUNCTION "public"."controlled_log_immutable"();

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. LOTES: PROTEGER LA TRAZABILIDAD (Baja, mina latente)
--
-- ProductBatch pasaba a Cascade desde Product: un borrado físico de producto
-- habría destruido los lotes y dejado en NULL el batchId de los asientos del
-- libro. Se cambia a Restrict.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE "public"."ProductBatch" DROP CONSTRAINT IF EXISTS "ProductBatch_productId_fkey";
ALTER TABLE "public"."ProductBatch"
  ADD CONSTRAINT "ProductBatch_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "public"."Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. ÍNDICES DE ALTO TRÁFICO (hallazgo A-10, parcial)
--
-- Postgres no indexa las llaves foráneas por sí solo. El cierre de caja agrega
-- las ventas del turno: sin índice en cashShiftId hace un seq scan de Sale
-- completa y degrada de forma monótona con el volumen.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "Sale_cashShiftId_idx"  ON "public"."Sale"("cashShiftId");
CREATE INDEX IF NOT EXISTS "Sale_clientId_idx"     ON "public"."Sale"("clientId");
CREATE INDEX IF NOT EXISTS "Sale_userId_idx"       ON "public"."Sale"("userId");
CREATE INDEX IF NOT EXISTS "Sale_flowStatus_idx"   ON "public"."Sale"("flowStatus");

-- Sostiene la validación anti-doble-devolución (acumula devoluciones por línea).
CREATE INDEX IF NOT EXISTS "SaleReturnItem_saleItemId_idx"    ON "public"."SaleReturnItem"("saleItemId");
CREATE INDEX IF NOT EXISTS "SaleReturnItem_saleReturnId_idx"  ON "public"."SaleReturnItem"("saleReturnId");
CREATE INDEX IF NOT EXISTS "SaleReturn_saleId_idx"            ON "public"."SaleReturn"("saleId");
CREATE INDEX IF NOT EXISTS "SaleRefund_saleId_idx"            ON "public"."SaleRefund"("saleId");

CREATE INDEX IF NOT EXISTS "PurchaseItem_purchaseId_idx" ON "public"."PurchaseItem"("purchaseId");
CREATE INDEX IF NOT EXISTS "PurchaseItem_productId_idx"  ON "public"."PurchaseItem"("productId");
CREATE INDEX IF NOT EXISTS "Purchase_supplierId_idx"     ON "public"."Purchase"("supplierId");
CREATE INDEX IF NOT EXISTS "Purchase_createdAt_idx"      ON "public"."Purchase"("createdAt");

-- El cierre de venta hace un updateMany por item sobre esta tabla de sólo
-- crecimiento: sin índice era un seq scan por cada línea vendida.
CREATE INDEX IF NOT EXISTS "ClientProductPriceHistory_client_product_idx"
  ON "public"."ClientProductPriceHistory"("clientId", "productId");
