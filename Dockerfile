FROM node:24-alpine AS frontend-build
WORKDIR /workspace
RUN chown node:node /workspace
USER node
COPY --chown=node:node frontend/package*.json ./frontend/
RUN npm ci --prefix frontend
COPY --chown=node:node frontend/index.html frontend/vite.config.js ./frontend/
COPY --chown=node:node frontend/public ./frontend/public
COPY --chown=node:node frontend/src ./frontend/src
ARG BASE_PATH=/ihme/
ENV BASE_PATH=${BASE_PATH}
RUN npm run build --prefix frontend

FROM node:24-alpine
ENV NODE_ENV=production
ENV PORT=3000
ARG BASE_PATH=/ihme/
ENV BASE_PATH=${BASE_PATH}
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node backend/package*.json ./backend/
RUN npm ci --omit=dev --prefix ./backend
COPY --chown=node:node backend/src ./backend/src
COPY --from=frontend-build --chown=node:node /workspace/frontend/dist ./frontend/dist
EXPOSE 3000
CMD ["node", "backend/src/server.js"]
