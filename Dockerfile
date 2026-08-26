# 多阶段：构建前端 + 编译 server，运行时只带产物与生产依赖。
# 基础镜像用 debian slim 而非 alpine：sodium-native（@fastify/secure-session 依赖）
# 的 prebuilds 目录不带 -musl 后缀，require-addon 在 musl 上找不到匹配（linux-arm64-musl），
# glibc 下直接命中预编译、无需编译链。
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7710 \
    VAULT_DIR=/data/vault
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/sample-vault ./sample-vault
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /data/vault && chown -R node:node /app
EXPOSE 7710
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:7710/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/docker-entrypoint.sh"]
