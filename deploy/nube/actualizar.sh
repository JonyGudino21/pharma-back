#!/usr/bin/env bash
# Publicar una versión nueva de PharmaPOS en la nube.
#
#   ./actualizar.sh
#
# 1) respaldo, 2) baja el código nuevo de ambos repositorios, 3) reconstruye y
# reinicia (la API aplica las migraciones al arrancar), 4) espera a que la API
# esté sana. Hazlo fuera de horario pico: las cajas verán "versión nueva".
set -euo pipefail
cd "$(dirname "$0")"

FRONT_DIR="${FRONT_DIR:-../../../pharma-front}"

echo "1/4 Respaldo previo…"
./respaldo.sh

echo "2/4 Descargando la versión nueva…"
git -C ../.. pull --ff-only
git -C "$FRONT_DIR" pull --ff-only

echo "3/4 Reconstruyendo y reiniciando…"
docker compose up -d --build
docker image prune -f >/dev/null

echo "4/4 Esperando a que la API responda…"
for _ in $(seq 1 60); do
  ESTADO=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null || echo starting)
  if [ "$ESTADO" = "healthy" ]; then
    echo "✓ Actualización terminada. API sana."
    exit 0
  fi
  sleep 5
done
echo "✗ La API no quedó sana en 5 minutos. Revisa: docker compose logs --tail=100 api" >&2
exit 1
