# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS web
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY web/ web/
COPY scripts/build-web.mjs scripts/
RUN npm run build:web

FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY web/embed.go web/index.html web/
COPY --from=web /src/web/dist web/dist
ARG BUILD_ID=dev
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build \
      -trimpath -ldflags="-s -w -X main.buildID=${BUILD_ID}" \
      -o /out/homelab ./cmd/homelab

# Preview com dados fictícios (sem Docker nem SQLite):
#   docker build -f infra/Dockerfile --target mock -t homelab-app-mock .
#   docker run -d -p 10003:3000 homelab-app-mock
FROM scratch AS mock
COPY --from=build /out/homelab /homelab
ENV HOMELAB_MOCK=1 PORT=3000 TZ=America/Sao_Paulo
EXPOSE 3000
USER 65532:65532
ENTRYPOINT ["/homelab"]

# Imagem final vazia: só o binário estático (assets, template e tzdata embutidos).
# Não há certificados CA porque o app só fala com o socket local do Docker.
FROM scratch
COPY --from=build /out/homelab /homelab
ENV DOCKER_SOCKET=/var/run/docker.sock \
    HOST_ROOT=/host \
    DB_PATH=/data/homepage.db \
    PORT=3000 \
    TZ=America/Sao_Paulo
VOLUME ["/data"]
EXPOSE 3000
USER 65532:65532
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD ["/homelab", "healthcheck"]
ENTRYPOINT ["/homelab"]
