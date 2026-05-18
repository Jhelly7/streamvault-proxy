FROM node:20-alpine

# Instalar cloudflared
RUN apk add --no-cache curl && \
    curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /usr/local/bin/cloudflared && \
    chmod +x /usr/local/bin/cloudflared

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY proxy.js ./
COPY start.sh ./
RUN chmod +x start.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-8080}/health || exit 1

CMD ["./start.sh"]
