# Recco relay — tiny WebSocket server, no database.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY relay.mjs ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "relay.mjs"]
