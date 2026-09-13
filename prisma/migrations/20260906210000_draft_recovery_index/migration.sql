-- FASE 3.2 — Recuperación del carrito DRAFT
--
-- `GET /sales/draft` corre en CADA carga del punto de venta y filtra por
-- (userId, flowStatus) ordenando por createdAt. Con los índices sueltos que ya
-- existían, PostgreSQL elegía el de `userId`, traía todas las ventas históricas
-- de ese cajero y filtraba y ordenaba en memoria. Para un cajero con 40 000
-- ventas acumuladas eso es un sort de 40 000 filas para devolver una.
--
-- El compuesto convierte la consulta en una búsqueda directa: posiciona por
-- userId + flowStatus y lee la primera fila en el orden que el índice ya
-- almacena. `DESC` en createdAt coincide con el ORDER BY del servicio, así que
-- no hay paso de ordenación.
--
-- CONCURRENTLY no se usa a propósito: `prisma migrate deploy` envuelve cada
-- migración en una transacción y PostgreSQL prohíbe CREATE INDEX CONCURRENTLY
-- dentro de una. En una tabla de este tamaño el bloqueo es de milisegundos.
CREATE INDEX IF NOT EXISTS "Sale_userId_flowStatus_createdAt_idx"
  ON "Sale" ("userId", "flowStatus", "createdAt" DESC);
