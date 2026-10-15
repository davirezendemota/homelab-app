.PHONY: build-web build-image check deploy mock

BUILD_ID := $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)
GO := docker run --rm -v "$(CURDIR)":/src -w /src -v homelab-gocache:/root/.cache -v homelab-gomod:/go/pkg/mod golang:1.25

# Assets do frontend (web/dist) — necessários antes de compilar o Go localmente.
build-web:
	npm run build:web

build-image:
	docker build -f infra/Dockerfile -t homelab-app:v3 --build-arg BUILD_ID=$(BUILD_ID) .

# Verificações (Go roda em container: não é preciso ter Go instalado no host).
check: build-web
	npm run typecheck
	$(GO) sh -c 'test -z "$$(gofmt -l cmd internal web)" || (gofmt -l cmd internal web; exit 1)'
	$(GO) go vet ./cmd/... ./internal/... ./web/...
	$(GO) sh -c 'CGO_ENABLED=1 go test -race ./cmd/... ./internal/...'

# Produção na porta 80 (substitui o container homelab-app).
deploy:
	BUILD_ID=$(BUILD_ID) docker compose -f infra/compose.production.yaml up -d --build

# Preview com dados fictícios na porta 10003.
mock:
	docker build -f infra/Dockerfile --target mock -t homelab-app-mock .
	docker rm -f homelab-app-mock 2>/dev/null || true
	docker run -d --name homelab-app-mock -p 10003:3000 homelab-app-mock && echo "preview: http://localhost:10003"
