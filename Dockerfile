FROM node:24-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/index.html frontend/vite.config.js ./
COPY frontend/src ./src
ARG BASE_PATH=/
RUN npm run build -- --base="${BASE_PATH}"

FROM node:24-alpine
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY backend/package*.json ./backend/
RUN npm install --omit=dev --prefix ./backend
COPY backend/src ./backend/src
COPY --from=frontend-build --chown=node:node /app/frontend/dist ./frontend/dist
EXPOSE 3000
USER node
CMD ["node", "backend/src/server.js"]
