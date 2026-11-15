# Tripzy on Render (Docker): one service serves the API and the built web app.
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
# Firebase web config is baked into the web bundle at build time (Render passes env vars as build args).
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_USE_EMULATORS=false
RUN npm run build && npm run gtfs -- hmrl tgsrtc
ENV NODE_ENV=production HOST=0.0.0.0
EXPOSE 10000
CMD ["npx", "tsx", "server/index.ts"]
