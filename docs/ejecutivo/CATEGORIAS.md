# Categorías de productos

> Documento ejecutivo. Detalle técnico en [`../CATEGORY_MODULE.md`](../CATEGORY_MODULE.md).

## Qué resuelve

Agrupa los productos en familias (analgésicos, vitaminas, perfumería…) para buscarlos y
administrarlos en bloque.

## Valor para el negocio

- Búsqueda y navegación más rápida del catálogo.
- Permite asignar el tratamiento de IVA a toda una familia de una vez.
- Base para reportes por línea de producto.

## Quién lo usa

| Rol | Qué puede hacer |
|---|---|
| Todos | Consultar y buscar categorías. |
| Farmacéutico, Gerente, Administrador | Crear, editar y desactivar. |

## Flujos principales

1. Crear la categoría.
2. Asignarla a productos desde la ficha del producto (un producto puede tener varias).
3. Desactivarla cuando deje de usarse.

## Reglas

- Nombre único al crear.
- La baja es lógica: los productos que la usan conservan la relación.

## Riesgos y limitaciones conocidas

- No hay subcategorías (jerarquía de un solo nivel).
- El tablero de analítica todavía no reporta ventas por categoría.

## Indicadores de éxito

- Porcentaje de productos con al menos una categoría.

## Estado

**Listo.**
