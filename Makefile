.PHONY: build-web build-image check

build-web:
	npm run build:web

build-image:
	docker build -f infra/Dockerfile -t homelab-app:v3 --build-arg BUILD_ID=$$(git rev-parse --short HEAD 2>/dev/null || echo dev) .

check:
	cd /tmp && true
