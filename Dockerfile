FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3111
ENV MAGIC_API_TRANSPORT=http
ENV MAGIC_API_HTTP_HOST=0.0.0.0
CMD ["node", "dist/index.js"]
