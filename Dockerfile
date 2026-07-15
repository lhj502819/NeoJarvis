FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY desktop/agent/ ./desktop/agent/
COPY web/dist/ ./web/dist/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npx", "tsx", "desktop/agent/index.ts"]
