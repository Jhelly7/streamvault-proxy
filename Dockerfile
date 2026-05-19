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

CMD ["./start.sh"]
