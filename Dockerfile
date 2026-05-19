FROM node:20-alpine

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

# Configuração do tunnel — ingress rules apontam para localhost:8080
RUN mkdir -p /etc/cloudflared
COPY config.yml /etc/cloudflared/config.yml

CMD ["./start.sh"]
