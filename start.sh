#!/bin/sh
if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
  echo "[start] A ligar tunnel cloudflared..."
  cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN" \
    --config /etc/cloudflared/config.yml &
  echo "[start] Tunnel iniciado em background"
else
  echo "[start] CLOUDFLARE_TUNNEL_TOKEN não definido — tunnel ignorado"
fi
echo "[start] A iniciar proxy..."
exec node proxy.js
