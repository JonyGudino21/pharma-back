#!/usr/bin/env bash
# Restaurar un respaldo de PharmaPOS en la nube.
#
#   ./restaurar.sh respaldos/pharma-....dump --prueba     # simulacro mensual
#   ./restaurar.sh respaldos/pharma-....dump --confirmar  # restauración REAL
#
# --prueba restaura en una base temporal, cuenta registros y la borra: no toca
# los datos de la farmacia. --confirmar saca antes un respaldo del estado
# actual, detiene la API, restaura en UNA transacción y vuelve a encenderla.
set -euo pipefail
cd "$(dirname "$0")"

ARCHIVO="${1:-}"
MODO="${2:-}"
if [ -z "$ARCHIVO" ] || [ ! -f "$ARCHIVO" ]; then
  echo "Uso: ./restaurar.sh <archivo.dump> --prueba|--confirmar" >&2
  exit 1
fi
if [ "$(stat -c%s "$ARCHIVO")" -lt 2048 ]; then
  echo "✗ $ARCHIVO pesa menos de 2 KB: no es un respaldo válido." >&2
  exit 1
fi

# Cuenta usuarios, ventas y productos ("u,v,p"). Se asigna a una variable ANTES
# de imprimir: un `$(…)` que falla dentro de echo no detiene el script y
# anunciaría "sirve" sobre un respaldo roto.
contar() {
  docker compose exec -T db psql -U pharmapos -v ON_ERROR_STOP=1 -d "$1" -tA -F, -c \
    'SELECT (SELECT count(*) FROM "User"), (SELECT count(*) FROM "Sale"), (SELECT count(*) FROM "Product")'
}
describir() {
  IFS=, read -r U V P <<< "$1"
  echo "$U usuario(s), $V venta(s), $P producto(s)"
}

case "$MODO" in
  --prueba)
    TMP=pharmapos_prueba_restauracion
    docker compose exec -T db dropdb -U pharmapos --if-exists "$TMP"
    docker compose exec -T db createdb -U pharmapos "$TMP"
    trap 'docker compose exec -T db dropdb -U pharmapos --if-exists "$TMP" >/dev/null; echo "  Base temporal eliminada."' EXIT
    docker compose exec -T db pg_restore -U pharmapos --no-owner --no-acl --exit-on-error -d "$TMP" < "$ARCHIVO"
    CUENTA=$(contar "$TMP")
    if [ "${CUENTA%%,*}" -lt 1 ]; then
      echo "✗ El respaldo se restauró pero no trae usuarios: no sirve para volver a operar." >&2
      exit 1
    fi
    echo "✓ EL RESPALDO SIRVE. Contiene: $(describir "$CUENTA")"
    ;;
  --confirmar)
    echo "1/3 Respaldo de seguridad del estado actual…"
    ./respaldo.sh
    echo "2/3 Deteniendo la API y restaurando…"
    docker compose stop api
    trap 'docker compose start api >/dev/null' EXIT
    docker compose exec -T db pg_restore -U pharmapos --clean --if-exists --no-owner --no-acl \
      --single-transaction --exit-on-error -d pharmapos < "$ARCHIVO"
    CUENTA=$(contar pharmapos)
    echo "3/3 Restauración terminada: $(describir "$CUENTA"). Encendiendo la API…"
    ;;
  *)
    echo "Archivo válido. No se hizo nada: elige --prueba (simulacro) o --confirmar (reemplaza los datos)."
    ;;
esac
