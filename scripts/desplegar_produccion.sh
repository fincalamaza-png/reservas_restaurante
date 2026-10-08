#!/bin/sh
# Despliegue de produccion: construye la imagen desde GitHub (main) y la actualiza en Docker Swarm.
set -e
SERV=reservas_fadrique_reservas_restaurante
IMG=easypanel/reservas_fadrique/reservas_restaurante:latest
echo "--- 1. Backup de la base de datos de produccion ---"
mkdir -p /root/backups
cp /var/lib/docker/volumes/reservas_fadrique_reservas_restaurante_reservas-db/_data/reservas.db /root/backups/reservas_prod_$(date +%Y%m%d_%H%M%S).db
echo "Backup guardado en /root/backups/"
echo "--- 2. Descargando el codigo de GitHub (main) ---"
D=$(pm2 describe donfadrique-dev | grep "exec cwd" | awk '{print $(NF-1)}')
git -C "$D" fetch -q origin main
B=/tmp/rr_build; rm -rf $B; mkdir -p $B
git -C "$D" archive origin/main | tar -x -C $B
echo "Version: $(git -C "$D" log --oneline -1 origin/main)"
echo "--- 3. Construyendo la imagen ---"
docker build -q -t $IMG $B
echo "--- 4. Actualizando el servicio ---"
docker service update --force --detach=false $SERV > /dev/null
echo "--- 5. Quitando copias antiguas ---"
for t in $(docker service ps $SERV -q --filter desired-state=shutdown); do
  c=$(docker ps -aq --filter label=com.docker.swarm.task.id=$t)
  [ -n "$c" ] && docker rm -f $c > /dev/null && echo "quitada copia $t" || true
done
sleep 5
echo "Copias funcionando: $(docker ps -q --filter label=com.docker.swarm.service.name=$SERV | wc -l)"
echo "Web real sin PIN: $(curl -s -o /dev/null -w '%{http_code}' https://restaurantefadrique.palaciocondealdana.com/api/reservas)"
echo "Icono: $(curl -s -o /dev/null -w '%{http_code}' https://restaurantefadrique.palaciocondealdana.com/icons/icon-192.png)"
echo "--- LISTO ---"
