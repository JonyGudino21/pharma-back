#!/usr/bin/env bash
# Respaldo de la base de PharmaPOS en la nube. Pensado para cron (diario).
#
#   ./respaldo.sh
#
# Deja pharma-AAAA-MM-DDTHH-MM-SS.dump en ./respaldos (o RESPALDOS_DIR),
# verifica que no esté vacío y borra los de más de RESPALDOS_DIAS (14).
set -euo pipefail
cd "$(dirname "$0")"

DIR="${RESPALDOS_DIR:-./respaldos}"
DIAS="${RESPALDOS_DIAS:-14}"
mkdir -p "$DIR"
ARCHIVO="$DIR/pharma-$(date +%Y-%m-%dT%H-%M-%S).dump"

echo "Respaldando → $ARCHIVO"
docker compose exec -T db pg_dump -U pharmapos -d pharmapos -Fc > "$ARCHIVO"

TAMANO=$(stat -c%s "$ARCHIVO")
if [ "$TAMANO" -lt 2048 ]; then
  rm -f "$ARCHIVO"
  echo "✗ FALLÓ EL RESPALDO: el archivo pesaba $TAMANO bytes (vacío). Hoy no hay copia." >&2
  exit 1
fi
echo "✓ Respaldo correcto: $((TAMANO / 1024)) KB"

find "$DIR" -name 'pharma-*.dump' -mtime +"$DIAS" -print -delete | sed 's/^/  Rotación: borrado /'
