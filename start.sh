#!/bin/sh

if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
  echo "[start] A ligar tunnel cloudflared..."
  # Usar --url com a porta dinâmica do Render (PORT injectado automaticamente)
  # Não usar config.yml — PORT pode variar entre deploys
  cloudflared tunnel --no-autoupdate run \
    --token "$CLOUDFLARE_TUNNEL_TOKEN" \
    --url "http://localhost:${PORT:-8080}" &
  echo "[start] Tunnel iniciado em background (url: http://localhost:${PORT:-8080})"
else
  echo "[start] CLOUDFLARE_TUNNEL_TOKEN não definido — tunnel ignorado"
fi

echo "[start] A iniciar proxy..."
exec node proxy.js
