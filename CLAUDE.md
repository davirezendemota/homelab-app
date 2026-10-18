# homelab-app (v3)

Dashboard de containers Docker do homelab: um binário Go estático que serve a API, o
stream SSE e o frontend (TS sem framework + idiomorph) embutido. Plano, specs e
critérios de aceite em `PLAN-V3.md`; decisões visuais em `docs/DESIGN-SYSTEM.md`.

## Estrutura

- `cmd/homelab` — entrada (servidor e `homelab healthcheck`)
- `internal/` — `docker` (socket, eventos, logs), `metrics` (cgroup v2, host, coletor), `hub` (SSE), `store` (SQLite), `history`, `server`, `mock`
- `web/src` — frontend; `render.ts` gera HTML em string e `main.ts` aplica com `Idiomorph.morph`
- `web/styles/app.css` — CSS de design herdado da v2 + Tailwind v4 (CLI, sem runtime)
- `infra/Dockerfile` (alvos padrão e `mock`), `infra/compose.production.yaml`

## Comandos

```sh
make check      # build dos assets, typecheck, gofmt, go vet e testes (-race)
make deploy     # produção na porta 80 via docker compose
make mock       # preview com dados fictícios na porta 10002
```

Go não está instalado no host: o `Makefile` roda o toolchain em container (`golang:1.25`).

## Regras

- Paridade visual com a v2: as classes em `web/src/ui.ts` são as que o shadcn/base-ui geravam.
  Mudanças de UI devem manter o markup/classe; conferir com capturas (`npm run screenshot:mock`).
- Toda lista renderizada precisa de `id` estável por item, para o idiomorph casar os nós.
- Nada de chamadas por container ao socket por ciclo: CPU/memória vêm do cgroup; `/system/df` só sob demanda.
- O pool SQLite tem uma conexão (`SetMaxOpenConns(1)`): nunca abrir query com outro cursor aberto.
- Deploy só por `infra/compose.production.yaml` (ver `~/workspace/CLAUDE.md`). `data/` pertence ao uid 65532.
