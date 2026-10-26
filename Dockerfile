FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
RUN mkdir /app/.local && chown node:node /app/.local
USER node
EXPOSE 8080
CMD ["node", "server/index.mjs"]
