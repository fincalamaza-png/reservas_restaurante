#!/bin/sh
# Pasa Gestión (versión de pruebas) a la web oficial restaurantefadrique.palaciocondealdana.com
# 1. Copia de seguridad de las dos bases de datos
# 2. Despliega la versión nueva (rama main) con el script de siempre
# 3. Trae de la versión de pruebas los datos propios de Gestión (gastos fijos, trabajadores,
#    pagos, eventos, documentos, menús nuevos…) SIN tocar las reservas ni las propuestas reales.
set -e
DEV=/data-dev/reservas.db
PROD=/var/lib/docker/volumes/reservas_fadrique_reservas_restaurante_reservas-db/_data/reservas.db
DIR=$(cd "$(dirname "$0")" && pwd)
F=$(date +%Y%m%d_%H%M%S)
echo "--- 0. Copias de seguridad ---"
mkdir -p /root/backups
python3 -c "import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d)" "$PROD" /root/backups/reservas_prod_antes_gestion_$F.db
python3 -c "import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d)" "$DEV" /root/backups/reservas_dev_antes_gestion_$F.db
echo "Guardadas en /root/backups/ (reservas_*_antes_gestion_$F.db)"
# Menús que tenía la oficial ANTES (esos no se tocan)
python3 -c "import sqlite3,json,sys; print(json.dumps([r[0] for r in sqlite3.connect(sys.argv[1]).execute('select nombre from plantillas_menu')]))" "$PROD" > /tmp/menus_oficiales_antes.json
sh "$DIR/desplegar_produccion.sh"
echo "--- 6. Esperando a que la versión nueva cree sus tablas ---"
i=0; until python3 -c "import sqlite3,sys; sqlite3.connect(sys.argv[1]).execute('select 1 from pagos limit 1')" "$PROD" 2>/dev/null; do i=$((i+1)); [ $i -gt 30 ] && echo "La web nueva no ha creado sus tablas: revisar" && exit 1; sleep 2; done
echo "--- 7. Trayendo los datos de Gestión desde la versión de pruebas ---"
python3 "$DIR/migrar_gestion.py" "$DEV" "$PROD" /tmp/menus_oficiales_antes.json
# Documentos subidos (fotos, PDF) de la versión de pruebas
if [ -d /data-dev/documentos ]; then mkdir -p "$(dirname $PROD)/documentos"; cp -n /data-dev/documentos/* "$(dirname $PROD)/documentos/" 2>/dev/null || true; fi
echo "--- LISTO: abre https://restaurantefadrique.palaciocondealdana.com ---"
