import { PaginationParamsDto } from 'src/common/dto/pagination-params.dto';

/** Página que se sirve cuando el cliente no pide ninguna. */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Techo duro. Aunque el DTO ya declara `@Max(100)`, los servicios también se
 * llaman entre sí y desde tareas internas, donde no pasa ningún validador.
 * El límite tiene que vivir donde se construye la consulta, no sólo en el borde
 * HTTP: una sola llamada interna con `limit: 999999` bastaba para saltarse la
 * protección.
 */
export const MAX_PAGE_SIZE = 100;

export interface PaginacionResuelta {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

export interface MetadatosPaginacion {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /**
   * Calculados aquí y no en el front: dos pantallas los derivaban a mano y una
   * de ellas usaba `page < totalPages` con `totalPages: 0`, así que el botón
   * "siguiente" quedaba muerto en la primera página de una lista vacía.
   */
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Traduce los parámetros de paginación que llegan del cliente a valores seguros
 * para `skip`/`take`.
 *
 * ─── EL PROBLEMA QUE CIERRA ───
 * Siete servicios repetían este patrón:
 *
 *     const hasPagination = pagination && (pagination.page ?? pagination.limit)
 *     if (!hasPagination) return { productos: await prisma.product.findMany({ where }) }
 *
 * Es decir: OMITIR la paginación devolvía la tabla ENTERA. Un `GET /products`
 * sin parámetros hacía un recorrido completo, serializaba cada fila a JSON y lo
 * mandaba por la red. Con un catálogo de 40 000 productos eso es una respuesta
 * de decenas de megabytes que:
 *   - mantiene una conexión del pool ocupada durante segundos (y el pool es
 *     compartido con los cobros del POS, que sí son urgentes);
 *   - se puede disparar en bucle desde fuera sin autenticación adicional, lo que
 *     lo convierte en una denegación de servicio de una sola línea de curl.
 *
 * Y además la FORMA de la respuesta cambiaba: con paginación traía `pagination`,
 * sin ella no. Cada consumidor tenía que soportar dos contratos distintos del
 * mismo endpoint.
 *
 * Ahora la paginación no es opcional: si no la piden, se aplica la de por
 * defecto. La respuesta tiene una sola forma, siempre.
 *
 * @param params lo que llegó del cliente (puede ser undefined)
 * @returns valores ya acotados y listos para Prisma
 */
export function resolvePagination(
  params?: Pick<PaginationParamsDto, 'page' | 'limit'>,
): PaginacionResuelta {
  const pedida = Number(params?.page);
  const pedidoLimite = Number(params?.limit);

  // Number.isFinite descarta NaN, Infinity y undefined de una vez: `Number(undefined)`
  // es NaN y `Math.max(1, NaN)` sigue siendo NaN, que llegaría a `skip` y haría
  // que Prisma devolviera un error de tipo en tiempo de ejecución.
  const page = Number.isFinite(pedida) && pedida >= 1 ? Math.floor(pedida) : 1;

  const limit =
    Number.isFinite(pedidoLimite) && pedidoLimite >= 1
      ? Math.min(Math.floor(pedidoLimite), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  const skip = (page - 1) * limit;

  return { page, limit, skip, take: limit };
}

/**
 * Construye los metadatos de la respuesta.
 *
 * `totalPages` nunca baja de 1: con 0 resultados, devolver `totalPages: 0`
 * hacía que el componente de paginación del front pintara "página 1 de 0".
 */
export function buildPaginationMeta(
  total: number,
  { page, limit }: PaginacionResuelta,
): MetadatosPaginacion {
  return {
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    hasNext: page * limit < total,
    hasPrev: page > 1,
  };
}
