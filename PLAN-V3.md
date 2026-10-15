# PLAN-V3 — Reescrita em Go + Vanilla JS + idiomorph

Reescrever o homelab-app como **um único binário Go** que serve a API, o stream de
atualizações (SSE) e um frontend **vanilla JS** com **idiomorph** para atualizar o
DOM sem recarregar a página. Sem Node, sem React, sem Next.js em runtime.

---

## 1. Ponto de partida (medido em 2026-10-14)

| Métrica | v2 (Next.js 16 standalone) |
|---|---|
| RAM do container `homelab-app` | ~112–125 MiB |
| Imagem de produção | 587 MB (`node:22-bookworm-slim` + `python3 make g++` no runner) |
| JS na 1ª carga | ~900 KB raw / ~280 KB gzip (7 chunks) |
| HTML da home | 322 KB raw (payload inicial serializado 2x: HTML + RSC) |
| CSS | 93 KB |
| `/api/status` | 16 KB a cada 5s **por aba**, mesmo sem mudança |
| Coleta de stats | `GET /containers/{id}/stats?stream=false` × 33 containers a cada 5s |
| `dockerd` CPU média | 16,9% |

### Problemas que a v3 resolve

1. **Stats via API do Docker**: `stream=false` faz o daemon esperar ~1s por uma
   segunda amostra para cada container, a cada 5s, mesmo sem ninguém olhando.
2. **`/containers/json` chamado 2x por ciclo** (`runningContainerStats` +
   `runningContainers`).
3. **UI renderizada por dois sistemas**: `dashboard-client.ts` (1.783 linhas
   imperativas, `@ts-nocheck`) + camada React em cima, sincronizadas por uma bridge.
4. **Polling do cliente** baixa o payload inteiro a cada 5s.
5. **Dependências e fontes em excesso**: 3 Google Fonts, `@base-ui/react`,
   `@radix-ui/react-checkbox` (não usado), `shadcn` (CLI) em `dependencies`,
   `lucide-react`, `tw-animate-css`.
6. **Dockerfile**: `apt-get install python3 make g++` no estágio final, imagem
   base Debian.

## 2. Metas da v3

| Métrica | Meta |
|---|---|
| RAM do container | **≤ 20 MiB** |
| Imagem | **≤ 15 MB** (`FROM scratch`/`distroless/static`) |
| JS na 1ª carga | **≤ 25 KB gzip** (app + idiomorph) |
| HTML da home | **≤ 30 KB raw** |
| CSS | **≤ 25 KB raw** |
| Chamadas ao `dockerd` em regime | **0 por ciclo** (cgroup + `/events`) |
| Coleta sem clientes conectados | **pausada** |
| Tráfego cliente sem mudanças | **0 bytes** (exceto keep-alive SSE) |
| Tempo de boot | < 100 ms |

Paridade funcional total com a v2 (mesmas rotas, mesmo SQLite, mesmo visual).

---

## 3. Decisões de arquitetura

| Tema | Decisão | Motivo |
|---|---|---|
| Linguagem backend | **Go 1.25+**, só `net/http` da stdlib (roteador com padrões `GET /api/x/{id}`) | Binário estático, ~10 MB RAM, sem framework |
| Docker | Cliente HTTP próprio no unix socket (porta do `unixRequest` atual) | Evita o SDK `docker/docker` (enorme) |
| Métricas de container | **cgroup v2** em `$HOST_ROOT/sys/fs/cgroup/system.slice/docker-<id>.scope/` | Custo zero no dockerd. Verificado: legível dentro do container atual (`cpu.stat`, `memory.current`), driver `systemd`, cgroup v2, Docker 29.6.2 |
| Lista de containers | Snapshot inicial + stream **`GET /events?filters={"type":["container"]}`** | Relista só em `start/stop/die/destroy/create/health_status/rename` |
| SQLite | **`modernc.org/sqlite`** (Go puro, sem CGO) | Permite `CGO_ENABLED=0` e imagem `scratch`; lê o `homepage.db` existente sem migração |
| Tempo real | **SSE** (`/api/stream`) com hub de assinantes | Push só quando muda; `EventSource` reconecta sozinho |
| Frontend | **Vanilla TS** (sem framework) empacotado com **esbuild** + **idiomorph** | Reaproveita `dashboard-client.ts`; idiomorph (~3 KB gz) faz a reconciliação do DOM |
| CSS | **Tailwind v4 standalone CLI** (binário, sem Node) no build | Mantém os tokens do `globals.css` e `DESIGN-SYSTEM.md`; purga classes não usadas |
| Assets | `//go:embed web/dist` | Um binário só; ETag por hash de conteúdo |
| Compressão | gzip na resposta de assets (pré-comprimidos no build) e no SSE | |
| Fontes | **Uma** fonte variável (Geist ou Inter) self-hosted em woff2 + `ui-monospace` | Corta 2 famílias e o request ao Google |
| Ícones | SVG inline (os SVGs já existem em `DashboardLive.tsx`/`dashboard-client.ts`) | Remove `lucide-react` |

### Por que idiomorph e não `innerHTML`

`innerHTML` recria os nós: perde foco, seleção, scroll, hover e menus abertos, e pode
piscar. `Idiomorph.morph(el, html, { morphStyle: "innerHTML" })` compara a árvore nova
com a atual e altera só as diferenças, como o React faz, com cerca de 3 KB. As funções
que hoje geram HTML em string (`renderStacksHtml`, `renderMeter`…) continuam iguais:
só muda a linha que aplica o HTML.

Regra: **todo nó de lista recebe `id` ou `data-key` estável** (`c-<containerName>`,
`s-<stackKey>`, `p-<projectId>`, `m-<meterKey>`), para o idiomorph casar os nós
corretamente.

---

## 4. Estrutura do repositório (v3)

```
homelab-app/
├── go.mod / go.sum
├── cmd/homelab/main.go            # flags/env, wiring, http.Server, graceful shutdown
├── internal/
│   ├── config/config.go           # ← src/lib/config.ts (+ LINK_HOST, HOMELAB_MOCK)
│   ├── docker/
│   │   ├── client.go              # ← unixRequest/dockerGet/dockerRequest/dockerOpenStream
│   │   ├── containers.go          # ← runningContainers, publishedPorts, parseHealth, ações, stack*
│   │   ├── events.go              # NOVO: assina /events, dispara relist
│   │   └── logs.go                # ← src/lib/logs.ts (demux 8 bytes, prefixo [nome] p/ stacks)
│   ├── metrics/
│   │   ├── cgroup.go              # NOVO: cpu.stat/memory.current/memory.stat por container
│   │   ├── host.go                # ← host-metrics.ts (/proc/stat, /proc/meminfo, hwmon, thermal, statfs, fstab, mounts)
│   │   ├── details.go             # ← meter-details.ts (cpu/ram/temp/storage; /system/df a cada 60s)
│   │   └── collector.go           # ← metrics-cache.ts: loop, diff, pausa sem clientes
│   ├── history/history.go         # ← container-start-history.ts (ring buffer 25, dedupe 4s)
│   ├── store/
│   │   ├── db.go                  # abre SQLite, schema + migrações (access_url, environment)
│   │   ├── prefs.go               # ← prefs.ts
│   │   └── projects.go            # ← projects.ts / project-model.ts
│   ├── hub/hub.go                 # NOVO: pub/sub SSE, contador de clientes
│   ├── mock/mock.go               # ← mock-dashboard-data.ts (HOMELAB_MOCK=1)
│   └── server/
│       ├── routes.go              # todas as rotas
│       ├── page.go                # GET / com html/template + payload inicial inline
│       ├── sse.go                 # GET /api/stream
│       └── static.go              # embed + ETag + gzip
├── web/
│   ├── src/
│   │   ├── main.ts                # boot: lê payload inicial, abre EventSource
│   │   ├── state.ts               # estado de UI (query, sort, prefs) + store simples
│   │   ├── render/                # funções puras → string HTML
│   │   │   ├── meters.ts          # ← renderMeter, MeterChart, StorageRow, usage charts
│   │   │   ├── stacks.ts          # ← renderStacksHtml, StackBlockView, linhas de container
│   │   │   ├── projects.ts        # ← DashboardProjects/ProjectCard
│   │   │   ├── history.ts         # ← DashboardContainerHistory
│   │   │   └── icons.ts           # SVGs inline
│   │   ├── ui/                    # comportamento (event delegation)
│   │   │   ├── actions.ts         # start/stop/restart/remove (container e stack)
│   │   │   ├── logs.ts            # modal de logs (fetch streaming + append)
│   │   │   ├── meter-modal.ts     # detalhe de meter (prev/next)
│   │   │   ├── project-editor.ts  # modal criar/editar projeto + drag&drop de ordem
│   │   │   ├── menus.ts           # dropdown de settings, select, toggle (substitui base-ui)
│   │   │   ├── dialog.ts          # <dialog> nativo
│   │   │   └── toast.ts
│   │   ├── morph.ts               # wrapper: patch(el, html) via Idiomorph
│   │   └── view-model.ts          # ← dashboard-view-model.ts (copiado quase igual)
│   ├── styles/app.css             # ← globals.css enxuto (tokens + componentes usados)
│   ├── fonts/                     # 1 woff2 variável
│   └── index.html.tmpl            # ← dashboard-body.html.ts + Header/Toolbar/Overlays
├── infra/
│   ├── Dockerfile                 # build multi-stage → scratch
│   └── Dockerfile.mock            # mesmo, com HOMELAB_MOCK=1
└── scripts/capture-mock-desktop.mjs   # mantém (dev-only, Playwright)
```

Removidos ao final: `src/`, `next.config.ts`, `next-env.d.ts`, `postcss.config.mjs`,
`components.json`, `tsconfig.tsbuildinfo`, `eslint.config.mjs`, `AGENTS.md`/`CLAUDE.md`
(conteúdo é sobre Next), deps de runtime do `package.json` (fica só dev: esbuild,
typescript, playwright).

---

## 5. Contrato da API (preservado)

Todas as rotas da v2 continuam com o mesmo formato de request/response, assim o
frontend pode ser portado em partes e scripts externos não quebram.

| Método | Rota | Origem v2 |
|---|---|---|
| GET | `/` | `src/app/page.tsx` (agora `html/template`) |
| GET | `/api/status` | mantido (fallback/debug; mesmo `PagePayload`) |
| GET | **`/api/stream`** | **NOVO**: SSE |
| GET | `/api/meters/{kind}` | `cpu`, `ram`, `temp`, `storage` |
| GET / PUT | `/api/prefs` | |
| GET / POST / PATCH | `/api/projects` | PATCH = reordenar (`{order: string[]}`) |
| PUT / DELETE | `/api/projects/{id}` | |
| POST | `/api/containers/{ref}/{start\|stop\|restart}` | |
| DELETE | `/api/containers/{ref}?force=` | |
| POST | `/api/stacks/{name}/{stop\|restart}` | |
| DELETE | `/api/stacks/{name}` | |
| GET | `/api/logs/{ref}` | streaming `text/plain`, `X-Accel-Buffering: no` |
| GET | `/api/logs/stack/{name}` | idem, linhas prefixadas `[container]` |

Validações a portar 1:1: `SAFE_CONTAINER_REF = ^[A-Za-z0-9][A-Za-z0-9_.-]*$`,
nome de stack sem `/` e `\0`; erros "inválid…" → 400, falha Docker → 502.
`requestHost`: `X-Forwarded-Host` → `Host` → `LINK_HOST` override.

### `/api/stream` (SSE)

```
event: status      data: <PagePayload completo>     # ao conectar
event: status      data: <PagePayload completo>     # quando algo muda
event: history     data: <ContainerLifecycleEvent[]>  # quando muda
: ping                                              # a cada 25s (keep-alive)
```

- O diff é feito **no servidor** (porta de `statusPayloadChanged`: CPU/MEM arredondados
  a 0,1 p.p., meters arredondados a 1%). Só publica se mudou.
- Payload enviado inteiro (16 KB, gzip ~2 KB); diff por campo não compensa a complexidade.
- O hub serializa o JSON **uma vez** por publicação e entrega o mesmo `[]byte` a todos.
- `host` varia por cliente (links de porta). Com `LINK_HOST` definido (produção), é igual
  para todos e o payload serializado é compartilhado; sem ele, o hub serializa uma vez
  por host distinto (na prática, 1–2 variantes).

---

## 6. Coleta de métricas otimizada

### 6.1 Collector

```
             ┌─────────── /events (stream Docker) ───────────┐
             ▼                                               │
  relist /containers/json?all=1  (só em eventos + a cada 60s como rede de segurança)
             │
  tick 5s ── se hub.Clients() > 0 ou última req < 30s:
             ├─ cgroup: cpu.stat (usage_usec) + memory.current − inactive_file
             ├─ host: /proc/stat (delta do tick anterior, sem sleep de 120 ms),
             │        /proc/meminfo, hwmon/thermal, statfs
             ├─ monta PagePayload → diff → hub.Publish se mudou
             └─ a cada 60s: storage detail (/system/df + mounts) e StartedAt
```

- **CPU do container** = Δ`usage_usec` / Δt(µs) × 100 (% de 1 core, igual ao
  `docker stats`). Guarda a amostra anterior por ID; o 1º tick mostra 0.
- **Memória do container** = `memory.current − memory.stat:inactive_file` (mesma
  fórmula do `docker stats` em cgroup v2), dividido pelo total do host.
- **CPU do host** = delta de `/proc/stat` entre ticks (remove o `sleep(120)` atual).
- **Fallback**: se `system.slice/docker-<id>.scope` não existir (driver `cgroupfs`
  ou rootless), tenta `/sys/fs/cgroup/docker/<id>/` e, por último,
  `stats?stream=false&one-shot=true` com delta calculado localmente.
- **Pausa**: sem clientes SSE e sem requests HTTP há 30s, o ticker para. O stream de
  `/events` continua (custo ~0) para manter o histórico de lifecycle.
- **Histórico de lifecycle** passa a vir de eventos reais (`start`, `restart`, `die`)
  em vez de comparar `StartedAt` por polling.

### 6.2 Concorrência

- Um `sync.RWMutex` guarda o snapshot. Handlers leem, o collector escreve.
- Ações (start/stop/…) disparam relist imediato e publish, e a UI atualiza sem esperar o tick.
- Logs: `io.Copy` do stream Docker → `http.Flusher`; stack logs com uma goroutine por
  container escrevendo num canal de linhas. O cancelamento vem de `r.Context()`.

---

## 7. Frontend vanilla + idiomorph

### 7.1 Modelo

```
payload inicial (JSON inline no HTML, <script type="application/json" id="boot">)
        │
  state = { data, prefs, view: {query, sortKey, sortDir, showHidden}, usageHistory }
        │
  render() ── agenda via requestAnimationFrame (coalesce múltiplas mudanças)
        ├─ patch(#meters,    renderMeters(state))
        ├─ patch(#stacks,    renderStacks(buildLists(state)))
        ├─ patch(#hidden,    …)
        ├─ patch(#projects,  renderProjects(state))
        └─ patch(#history,   renderHistory(state))
        │
  EventSource("/api/stream").on("status") → state.data = payload → render()
```

- **Event delegation**: um listener por região (`#stacks`, `#projects`, `document`
  para atalhos) lendo `data-action` / `data-id`. O morph não precisa re-anexar eventos.
- Prefs: `PUT /api/prefs` otimista (atualiza o estado, renderiza, envia; reverte em erro).
- Migração do `localStorage` legado (`LEGACY_KEYS`) mantida.
- `visibilitychange`: fecha o `EventSource` com a aba oculta e reabre ao voltar, assim o
  servidor pausa a coleta.
- Gráficos de uso (`usageHistory` cpu/ram/temp): SVG gerado em string, também via morph.

### 7.2 Inventário a portar (React → vanilla)

| Origem v2 | Destino v3 | Observação |
|---|---|---|
| `dashboard-client.ts` (1.783 l.) | `web/src/*` dividido por responsabilidade | Remover o caminho `reactMode`/`bridge`; trocar `innerHTML` de listas por `patch()` |
| `dashboard-view-model.ts` | `web/src/view-model.ts` | Puro, cópia quase direta |
| `DashboardLive.tsx` (988 l.) | `render/stacks.ts`, `render/meters.ts`, `icons.ts` | `rowPropsEqual`/`metersEqual` somem (o idiomorph cuida) |
| `DashboardProjects.tsx` (662 l.) | `render/projects.ts` + `ui/project-editor.ts` | Drag & drop com Pointer Events nativos; modal com `<dialog>` |
| `DashboardHeader.tsx` | `index.html.tmpl` + `ui/menus.ts` | Menu de settings → `<details>`/popover nativo (`popover` attr) |
| `DashboardToolbar.tsx` | template + delegation | Busca, sort, mostrar ocultos |
| `DashboardContainerHistory.tsx` | `render/history.ts` | |
| `MetersLayoutToggle.tsx` | template + `ui/menus.ts` | |
| `DashboardStaticBlocks.tsx` / `dashboard-body*.ts` | `index.html.tmpl` | HTML estático direto no template |
| `components/ui/*` (shadcn/base-ui) | CSS + elementos nativos | `<dialog>`, `<select>`, `<input type=checkbox>`, `popover` |
| `next/font/google` ×3 | 1 woff2 self-hosted | `font-display: swap`, `<link rel=preload>` |

### 7.3 CSS

- Partir do `globals.css` (93 KB): manter tokens `:root`/`.dark` e classes usadas pelos
  templates; remover `tw-animate-css`, utilitários do shadcn não usados e o que só os
  componentes base-ui usavam.
- Tailwind v4 standalone CLI com `@source "web/src/**/*.ts"` e `web/*.tmpl`, minificado.
- Respeitar `docs/DESIGN-SYSTEM.md`.

---

## 8. Dockerfile otimizado

Sem `apt-get` em nenhum estágio, sem Node na imagem final, sem toolchain C (SQLite em Go
puro).

```dockerfile
# syntax=docker/dockerfile:1.7

# ── 1. assets (esbuild + tailwind standalone; Node só no build) ──
FROM node:22-alpine AS web
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts            # só devDeps: esbuild, typescript, idiomorph, tailwind cli
COPY web/ web/
RUN npm run build:web                   # → web/dist/{app.js,app.css,fonts/*} + .gz

# ── 2. binário Go estático ──
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY web/embed.go web/
COPY --from=web /src/web/dist web/dist
COPY web/index.html.tmpl web/
ARG BUILD_ID=dev
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build \
      -trimpath -ldflags="-s -w -X main.buildID=${BUILD_ID}" \
      -o /out/homelab ./cmd/homelab

# ── 3. runtime mínimo ──
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/homelab /homelab
ENV DOCKER_SOCKET=/var/run/docker.sock \
    HOST_ROOT=/host \
    DB_PATH=/data/homepage.db \
    PORT=3000 \
    TZ=America/Sao_Paulo
VOLUME ["/data"]
EXPOSE 3000
USER 65532:65532
ENTRYPOINT ["/homelab"]
```

Notas:
- `distroless/static:nonroot` (~2 MB) inclui CA certs, `/etc/passwd` e tzdata mínimo.
  Para zerar ainda mais, `FROM scratch` + `COPY --from=build /usr/share/zoneinfo` e
  `import _ "time/tzdata"` no Go (adiciona ~450 KB ao binário). **Escolha: distroless.**
- **Healthcheck**: não há `curl` na imagem; o binário aceita `homelab healthcheck`
  (faz GET em `/healthz` e sai 0/1). Em compose: `test: ["CMD", "/homelab", "healthcheck"]`.
- **Permissões**: `data/homepage.db` hoje é `root:root`. Antes do 1º deploy:
  `sudo chown -R 65532:65532 data/`. O acesso ao socket continua via `group_add: ["990"]`.
- `.dockerignore`: adicionar `node_modules`, `.next`, `src`, `docs`, `data`, `*.md`.
- `Dockerfile.mock`: mesmo arquivo com `ARG HOMELAB_MOCK=1` → `ENV`; pode virar um
  target (`--target mock`) em vez de outro Dockerfile.
- **Dev**: `go run ./cmd/homelab` + `npm run watch:web` (esbuild `--watch`), servindo
  `web/dist` do disco quando `HOMELAB_DEV=1` (sem embed). O `Dockerfile` de dev com
  `npm run dev` e o volume de `node_modules` deixam de existir.

Tamanho esperado: binário ~9–12 MB (`-s -w`, modernc sqlite inclui ~5 MB) + base 2 MB,
**≈ 12–14 MB**.

---

## 9. Deploy

Conforme `~/workspace/CLAUDE.md`: **Docker Compose** a partir do arquivo versionado no
repositório (o Portainer não é mais usado neste host). A v2 já sobe assim, com
`infra/compose.production.yaml`; a v3 reescreve esse mesmo arquivo.

1. `infra/compose.production.yaml` (v3):
   ```yaml
   services:
     app:
       image: homelab-app:v3
       build:
         context: ..
         dockerfile: infra/Dockerfile
       container_name: homelab-app
       restart: unless-stopped
       ports: ["80:3000"]
       environment:
         LINK_HOST: homelab01
         TZ: America/Sao_Paulo
       volumes:
         - ../data:/data
         - /var/run/docker.sock:/var/run/docker.sock
         - /:/host:ro,rslave
       group_add: ["990"]
       read_only: true
       cap_drop: [ALL]
       security_opt: ["no-new-privileges:true"]
       mem_limit: 64m
   ```
   O healthcheck (`/homelab healthcheck`) vem da própria imagem.
2. Deploy: `docker compose -f infra/compose.production.yaml up -d --build`.
3. Durante a validação: v3 em paralelo na porta **10003**. Corte para a 80 só após
   o checklist da Fase 5.
4. Rollback: a imagem `homelab-app:latest` (v2) permanece; basta voltar o `image:` do
   compose (ou fazer checkout do compose anterior) e rodar `up -d`.
5. Remover `compose.yaml` (dev da v2) após o corte; o preview mock vira um `target`
   do mesmo Dockerfile.

---

## 10. Especificações

Fonte da verdade do comportamento esperado da v3. Onde não houver nota em contrário, o
comportamento é **idêntico ao da v2** (referência: arquivos citados em `src/`).

### 10.1 Configuração e CLI

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Socket da API Docker |
| `HOST_ROOT` | `/host` | Raiz do host (sysfs, cgroup, mounts, fstab). Sem barra final |
| `DB_PATH` | `/data/homepage.db` | SQLite (diretório criado se não existir) |
| `LINK_HOST` | *(vazio)* | Se definido, sobrescreve o host dos links de porta |
| `HOMELAB_MOCK` | *(vazio)* | `1`/`true`/`yes` → dados fictícios, sem Docker nem SQLite |
| `HOMELAB_BUILD_ID` | `-ldflags main.buildID` ou `dev` | Vai em `build`/`loaded_build` do payload |
| `HOMELAB_DEV` | *(vazio)* | `1` → serve `web/dist` do disco em vez do embed |
| `TZ` | `America/Sao_Paulo` | Fuso dos horários |

Constantes (não configuráveis): tick do collector **5s**; refresh de storage e
`StartedAt` **60s**; ociosidade para pausar **30s**; keep-alive SSE **25s**;
`LOG_TAIL` **200**; histórico de lifecycle **25** eventos, dedupe **4s**; timeout
Docker **5s** (leitura) e **120s** (ações).

CLI:
- `homelab`: inicia o servidor. Encerra com `SIGTERM`/`SIGINT` em até 5s (graceful:
  fecha SSE, cancela logs, fecha o SQLite).
- `homelab healthcheck`: `GET http://127.0.0.1:$PORT/healthz`; exit `0` se 200, `1` caso
  contrário, timeout 2s.
- Log em stdout, uma linha por evento relevante (boot, erro Docker, reconexão de
  `/events`, pausa/retomada do collector). **Não** loga cada request.

### 10.2 Modelos de dados (JSON)

Os nomes de campo são exatamente os da v2; o Go usa tags `json:"..."`.

```ts
ContainerRow {
  id: string            // 12 primeiros chars do Id
  name: string          // Names[0] sem "/", ou id
  image: string
  status: string        // Status cru do Docker ("Up 3 hours (healthy)")
  ports: number[]       // PublicPort TCP, únicos, ordem crescente
  stack: string         // label com.docker.compose.project ou "sem stack"
  health: "healthy" | "unhealthy" | "starting" | null   // extraído de status
  cpuPct: number | null // null se não está rodando
  memPct: number | null // % da RAM total do host; null se não está rodando
}
// Ordem: stack (case-insensitive, localeCompare), depois name.

Meter {                 // 4 itens, nesta ordem: CPU, RAM, Temperatura, Armazenamento
  label, display, sub: string; showSub: boolean
  color: string         // meterColor(pct): ≥85 #f85149, ≥65 #e3b341, senão #3fb950
  barWidth: string      // "NN%"
  showBar, showCaption: boolean; caption: string
  showChart?: boolean; chartKey?: "cpu"|"ram"|"temp"; pct?: number
  detailKey: "cpu"|"ram"|"temp"|"storage"
  type?: "storage"; main?: StorageMount; mounts?: StorageMount[]
}
// CPU:   display "NN%", sub "N cores"
// RAM:   display "NN%", sub "U.U / T GB" (used = MemTotal − MemAvailable)
// Temp:  display "NN°C", sub "CPU"|"Sistema"; cor ≥85/≥65; sem sensor →
//        display "—", sub "indisponível", showBar false, sem chart
// Storage: soma de "/" + mounts extras; showBar false

StorageMount { path, label: string; pct: number; used_gb, total_gb: number; color: string }
// "/" sempre presente (cor #3fb950); extras com MOUNT_COLORS em ciclo;
// ignora /boot e /boot/efi; deduplica por device.

ContainerLifecycleEvent { at: number /*epoch ms*/; name, stack: string; kind: "started"|"restarted" }

PagePayload {
  host: string; build: string; loaded_build: string; error: string | null
  containers: ContainerRow[]; meters: Meter[]; containerHistory: ContainerLifecycleEvent[]
}

Prefs {
  favorites: string[]          // ordem preservada
  hiddenContainers: string[]   // ordem alfabética
  hiddenStacks: string[]       // ordem alfabética
  collapsedStacks: string[]    // chaves; favoritos = "__favorites__"
  settings: { compactView: boolean; truncateNames: boolean; verticalMeters: boolean }
}

Project {
  id: string (UUID v4); name: string; accessUrl: string /* "" ou URL normalizada */
  environment: "dev"|"homolog"|"producao"; containers: string[]  // nomes, ordem preservada
}

MeterDetail (GET /api/meters/{kind}) — sempre inclui "kind"; em falha { kind, error }
  cpu:     { rows: [{name, sub: stack, value: pct, display}], total: 100 }      // desc por value
  ram:     { rows: [{name, sub, value: bytes, display: "X MB · Y%"}], total: bytesHost,
             summary: { sub, display } }
  temp:    { rows: [{name: "chip · label" | "thermal_zoneN · type", value: °C, display}], total: 100 }
  storage: { total: bytes, sections: [
             { title: "Containers", rows: [...{writable, image, volumes}], columns: ["writable","image","volumes"] },
             { title: "Imagens", rows }, { title: "Volumes", rows }, { title: "Build cache", rows } ] }
```

Formatação compartilhada (servidor): `formatBytes` (B/KB/MB/GB com 1 casa, base 1024) e
`formatPct` (≥10 → 0 casas, ≥1 → 1 casa, senão 2 casas).

**Mudança intencional em relação à v2:** a memória do container passa a ser
`memory.current − inactive_file` (igual ao `docker stats` da CLI). A v2 usava
`memory_stats.usage` cru, que inclui page cache. Os valores ficam menores e mais
próximos do que o `docker stats` mostra.

### 10.3 API: comportamento por rota

Regras gerais:
- Todas as respostas JSON: `Content-Type: application/json; charset=utf-8` e
  `Cache-Control: no-store`. Erro: `{"error": "<mensagem em pt-BR>"}`.
- Body JSON inválido → `400 {"error":"JSON inválido"}`. Body > 1 MiB → `413`.
- Método não suportado → `405`; rota inexistente → `404 {"error":"Not Found"}`.
- `ref` de container: `^[A-Za-z0-9][A-Za-z0-9_.-]*$`, senão `400 "Referência de container inválida"`.
- Nome de stack: não vazio, sem `/` e sem `\0`, senão `400 "Nome de stack inválido"`.
- Erro vindo do Docker → `502` com a mensagem `Docker API <status>: <corpo>`.
- Em `HOMELAB_MOCK`, rotas de escrita respondem como sucesso sem efeito colateral
  persistente (igual à v2).

| Rota | Sucesso | Erros / regras |
|---|---|---|
| `GET /healthz` | `200 ok` (texto) | Não depende do Docker |
| `GET /` | `200` HTML com payload inicial em `<script type="application/json" id="boot">` | Se o cache ainda não aqueceu, aguarda o 1º ciclo (máx. 3s) e depois serve o que houver |
| `GET /api/status` | `200 PagePayload` | Retorna o snapshot; não dispara coleta |
| `GET /api/stream` | SSE (10.4) | |
| `GET /api/meters/{kind}` | `200 MeterDetail` | `kind` fora de `cpu,ram,temp,storage` → `400 {kind, error:"Tipo de métrica inválido"}`; sem dado ainda → `200 {kind, error:"Dados ainda não disponíveis"}` |
| `GET /api/prefs` | `200 Prefs` | |
| `PUT /api/prefs` | `200 Prefs` (estado após gravar) | Body deve ser objeto. Cada chave presente **substitui** a lista inteira; chaves ausentes ficam intactas; `settings` aceita só as 3 chaves conhecidas. Tudo numa transação |
| `GET /api/projects` | `200 {projects: Project[]}` | Ordem: `position`, depois `name` |
| `POST /api/projects` | `201 Project` | `name` obrigatório (trim) → `400 "Nome do projeto é obrigatório"`; `accessUrl` sem esquema recebe `https://`; esquema ≠ http/https → `400 "Link deve usar http ou https"`; URL inválida → `400 "Link de acesso inválido"`; `environment` inválido → `dev`; entra no fim da lista |
| `PATCH /api/projects` | `200 {projects}` | `order` deve ser array → senão `400`; tamanho ≠ total → `400 "Lista de ordem incompleta"`; id desconhecido → `400 "Projeto inválido na ordem"` |
| `PUT /api/projects/{id}` | `200 Project` | Patch parcial (`name`, `accessUrl`, `environment`, `containers`); `containers` com trim e sem duplicados, ordem preservada; id inexistente → `404 "Projeto não encontrado"` |
| `DELETE /api/projects/{id}` | `200 {ok:true}` | Inexistente → `404`; apaga `project_containers` em cascata |
| `POST /api/containers/{ref}/{action}` | `200 {ok:true}` | `start`/`restart` registram evento de lifecycle; `stop` usa `t=30`; outra ação → `404` |
| `DELETE /api/containers/{ref}?force=` | `200 {ok:true}` | `force` padrão `true` (`1/true/yes`) |
| `POST /api/stacks/{name}/{stop\|restart}` | `200 {ok:true}` | Até 8 em paralelo; `stop` só nos rodando |
| `DELETE /api/stacks/{name}` | `200 {ok:true}` | Remove todos com `force=true` |
| `GET /api/logs/{ref}` | `200 text/plain` streaming | 10.6 |
| `GET /api/logs/stack/{name}` | `200 text/plain` streaming | Stack sem containers → `502 "Nenhum container nesta stack"` |

Depois de qualquer ação em container ou stack, o servidor faz relist e publica no
hub **antes** de responder, assim a próxima mensagem SSE já reflete o novo estado.

Host dos links (`PagePayload.host`): `LINK_HOST` se definido; senão o 1º valor de
`X-Forwarded-Host`, ou `Host`, sem a porta; `0.0.0.0`/`::`/`[::]` viram `localhost`.

### 10.4 SSE (`GET /api/stream`)

- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-store`,
  `X-Accel-Buffering: no`, `Connection: keep-alive`. Gzip **não** é aplicado ao SSE
  (evita buffering em proxies); o payload já é pequeno.
- Na conexão: envia `retry: 3000`, depois `event: status` com o snapshot atual (com o
  `host` do request), sem esperar o próximo tick.
- `event: status`: só quando o snapshot mudou segundo a regra de diff (abaixo).
- `event: history`: só quando a lista de lifecycle mudou.
- `: ping` a cada 25s sem outras mensagens.
- Cada cliente tem um buffer de 1 mensagem. Se o cliente estiver lento, a mensagem
  pendente é **substituída** pela mais nova (o servidor nunca bloqueia nem acumula).
- Desconexão (`r.Context().Done()`) remove o assinante na hora.
- Máximo de **32** clientes simultâneos; acima disso → `503`.

Regra de diff (porta de `statusPayloadChanged`): mudou se mudar `error`, quantidade ou
ordem de containers/meters, ou em algum container mudar `id`, `name`, `status`,
`image`, `health`, `stack`, `ports`, `round(cpuPct×10)`, `round(memPct×10)`; ou em algum
meter mudar `display`, `barWidth`, `color`, `sub` ou `round(pct)`.

### 10.5 Collector

Estados: `warming` → `active` ⇄ `paused`.

- **warming** (boot): relist completo, uma amostra de cgroup e `/proc/stat` (baseline),
  storage, `StartedAt`; abre `/events`. Termina em ≤ 3s ou na 1ª falha (com `error`
  preenchido).
- **active**: tick a cada 5s. Cada tick lê cgroups e host e monta o snapshot; se mudou,
  publica.
- **paused**: entra quando `clientesSSE == 0` e não houve request HTTP (fora
  `/healthz`) há 30s. Para o ticker. Volta a `active` no próximo request ou conexão
  SSE, fazendo um tick **imediato**.
- `/events` fica aberto em qualquer estado. Eventos `create`, `start`, `restart`,
  `die`, `stop`, `destroy`, `rename`, `health_status*` disparam relist com debounce de
  300 ms. Em `paused`, o relist atualiza só a lista e o histórico (sem cgroup).
- Relist de segurança a cada 60s, só em `active`.
- Reconexão de `/events`: backoff 1s → 2s → 4s … máx. 30s, com relist completo ao
  reconectar. Durante a queda, o relist de segurança passa a rodar a cada 5s.

Métricas por container (cgroup v2):
- Diretório: procura em ordem `$HOST_ROOT/sys/fs/cgroup/system.slice/docker-<idCompleto>.scope`,
  `$HOST_ROOT/sys/fs/cgroup/docker/<idCompleto>`, e os mesmos sem `$HOST_ROOT`. O
  caminho encontrado é cacheado por id.
- `cpuPct = (usage_usec₂ − usage_usec₁) / (t₂ − t₁ em µs) × 100`. Pode passar de 100 em
  multi-core, igual à v2. Primeira amostra ou contador regredindo → `0`.
- `memBytes = memory.current − inactive_file` (mínimo 0); `memPct = memBytes / MemTotal × 100`.
- Container sem diretório de cgroup → fallback
  `GET /containers/{id}/stats?stream=false&one-shot=true`, com delta calculado contra a
  amostra anterior guardada. Loga **uma vez** por container que caiu no fallback.

Métricas do host:
- CPU: delta de `/proc/stat` (linha `cpu`) entre ticks, `round((1 − Δidle/Δtotal)×100)`
  limitado a 0..100; `idle = idle + iowait`.
- RAM, temperatura, storage: mesma lógica de `host-metrics.ts` (hwmon preferido:
  `coretemp, k10temp, zenpower, applesmc, cpu_thermal, soc_thermal`; ignora `acpitz`;
  mounts de `fstab` + filhos de `/mnt`, `/media`, `/srv`).

Histórico de lifecycle (a partir de `/events`):
- `start` de um nome **nunca visto** desde o boot → `started`.
- `start` de um nome visto antes (parado, ou com outro id) → `restarted`.
- `restart` → `restarted`.
- Ações via API (`start`/`restart`) registram na hora; o evento do Docker que vier
  depois cai no dedupe (mesmo nome + kind em < 4s).
- Lista em memória, mais novo primeiro, máximo 25. Não persiste entre reinícios (como na v2).

### 10.6 Logs

- Container: `GET /containers/{ref}/logs?stdout=1&stderr=1&follow=1&tail=200&timestamps=0`.
  Se `Config.Tty == false`, faz o demux do stream multiplexado (header de 8 bytes,
  tamanho big-endian nos bytes 4..7), tratando frames que chegam **partidos entre
  chunks** (a v2 descartava esse caso).
- Stack: abre o log de cada container da stack em paralelo; cada linha sai como
  `[<nome>] <linha>\n`; linhas de containers diferentes nunca se misturam no meio. Erro
  de um container vira a linha `[<nome>] erro: <msg>` e os outros continuam. A resposta
  termina quando todos terminarem.
- Flush após cada escrita. Fechar o request (cliente fecha o modal) encerra todas as
  conexões com o Docker em ≤ 1s.

### 10.7 Persistência

- Abre o SQLite com `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`; uma
  conexão (`SetMaxOpenConns(1)`).
- Boot: `CREATE TABLE IF NOT EXISTS` de todas as tabelas da v2 e as migrações
  `ADD COLUMN access_url` / `ADD COLUMN environment DEFAULT 'dev'` se faltarem.
  **Nunca** apaga nem renomeia colunas ou tabelas.
- Sem permissão de escrita em `DB_PATH` → o processo sai com código 1 e a mensagem
  `DB_PATH não gravável: <path> (uid=<uid>)`.

### 10.8 Frontend

Boot:
1. O HTML já vem renderizado pelo servidor (template Go) com os dados iniciais, sem
   tela vazia nem flash. O JS lê `#boot`, monta o estado e **hidrata** (anexa listeners)
   sem re-renderizar se nada mudou.
2. Carrega prefs junto no `#boot` (o servidor inclui `Prefs`), sem round-trip extra.
3. Migração do `localStorage` legado: se houver chaves `homelab-homepage-*` e o
   servidor não tiver prefs, envia `PUT /api/prefs` e apaga as chaves.
4. Abre `EventSource("/api/stream")`.

Atualização:
- Cada `status` recebido → atualiza `state.data`, adiciona amostras em `usageHistory`
  (cpu/ram/temp, máx. 60 pontos cada) e agenda `render()` no próximo
  `requestAnimationFrame` (vários eventos no mesmo frame = um render).
- `render()` chama `patch(região, html)` só nas regiões cujo input mudou (comparação
  por referência do pedaço de estado).
- Relógio "Atualizado HH:MM:SS" (pt-BR) é atualizado a cada `status` recebido.
- Conexão perdida → banner discreto "Reconectando…"; some no próximo `status`.
- Aba oculta → fecha o `EventSource`; aba visível → reabre (recebe o snapshot na hora).

Interações (iguais à v2):
- **Busca**: filtra por nome, imagem ou stack (case-insensitive, trim). Aplica a cada
  tecla, sem debounce.
- **Ordenação**: clicar numa coluna (`name`, `port`, `status`) alterna
  asc → desc → sem ordenação. Com ordenação ativa, a lista fica plana (sem stacks).
  `port` ordena pela 1ª porta (sem porta vai para o fim); `status` ordena pelo uptime.
- **Favoritos**: estrela adiciona ou remove; o grupo "Favoritos" aparece no topo, na
  ordem de adição.
- **Ocultar** container ou stack: some da lista; "mostrar ocultos" exibe a seção de
  ocultos (ou mistura na lista plana quando ordenada). O contador de ocultos fica visível.
- **Colapsar stack**: persistido em `collapsedStacks`.
- **Ações**: start, stop, restart sem confirmação; delete com `confirm()` (textos da
  v2). Toast "info" persistente durante a ação → vira "success" (4,5s) ou some e
  mostra "error" (6s). Erro de rede → "Conexão perdida com o servidor…".
- **Links de porta**: `https` para 443/8443/9443, senão `http`, com `PagePayload.host`.
- **Modal de meter**: abre ao clicar no card; navegação prev/next entre os 4 kinds;
  `cpu` atualiza a cada 5s enquanto aberto; fecha com Esc, clique fora ou botão.
- **Modal de logs**: streaming via `fetch` + `ReadableStream`; auto-scroll só se o
  usuário estiver no fim; copiar (ícone muda para ✓ por 1,5s), limpar, barra de
  progresso de scroll; fechar aborta o fetch. Mantém no máximo **5.000** linhas no DOM
  (descarta as mais antigas).
- **Projetos**: card com nome, ambiente (badge Dev/Homolog/Produção), link de acesso e
  containers agrupados por stack com status. Criar e editar em `<dialog>`; apagar com
  confirmação; reordenar com drag & drop (mouse e touch), que persiste com
  `PATCH /api/projects`. Durante o drag, as atualizações SSE **não** alteram a ordem
  visual.
- **Settings**: compact view, truncate names, vertical meters (persistidos); tela
  cheia (Fullscreen API).
- **Teclado**: Esc fecha o modal ou menu aberto; Tab percorre todos os controles com
  foco visível.

Preservação de estado durante um `patch()` (requisito do idiomorph):
- foco e posição do cursor no input de busca;
- menus ou popovers abertos;
- scroll das listas e dos modais;
- `<dialog>` aberto e o conteúdo digitado nos formulários de projeto;
- item sendo arrastado.

### 10.9 Requisitos não funcionais

| Tema | Requisito |
|---|---|
| Navegadores | Últimas 2 versões de Chrome, Firefox e Safari (desktop e mobile). Sem polyfills |
| Responsivo | Funcional de 360px a 2560px de largura, sem scroll horizontal da página |
| Tema | Escuro (como hoje), tokens de `docs/DESIGN-SYSTEM.md` |
| Acessibilidade | Controles com `aria-label`, contraste AA nos textos, `prefers-reduced-motion` desliga animações |
| Segurança HTTP | `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, CSP `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:` |
| Escape | Todo texto vindo do Docker (nomes, imagens, logs) é escapado antes de ir para HTML (`html/template` no servidor, `esc()` no cliente). Logs entram via `textContent` |
| Container | Roda como uid 65532, `read_only`, `cap_drop: ALL`, `no-new-privileges`, `mem_limit: 64m` |
| Dependências Go | Só stdlib + `modernc.org/sqlite`. Qualquer outra precisa de justificativa no PR |
| Dependências JS (runtime) | Só `idiomorph` |
| Qualidade | `go vet` e `staticcheck` limpos; `tsc --noEmit` sem erros (sem `@ts-nocheck`); `go test -race ./...` verde |

---

## 11. Critérios de aceite

Cada critério tem um ID para citar em commits e PRs. **Método** indica como verificar:
`T` = teste automatizado (Go `go test` ou Playwright), `S` = script de verificação em
`scripts/v3-checks/`, `M` = verificação manual com roteiro.

### 11.1 Build e imagem

| ID | Critério | Método |
|---|---|---|
| AC-BLD-01 | `docker build -f infra/Dockerfile .` conclui sem nenhum `apt-get`/`apk add` em qualquer estágio | S (`grep` no Dockerfile + build) |
| AC-BLD-02 | Imagem final ≤ **15 MB** (`docker image inspect --format '{{.Size}}'`) | S |
| AC-BLD-03 | Imagem final não contém `node`, `npm`, `sh`, `apt` (`docker run --entrypoint` falha) | S |
| AC-BLD-04 | Rebuild sem mudanças de código usa cache e termina em < 30s | M |
| AC-BLD-05 | `go vet`, `staticcheck`, `tsc --noEmit` e `go test -race ./...` passam no build | T |
| AC-BLD-06 | `homelab healthcheck` retorna 0 com o servidor no ar e 1 com ele parado | T |

### 11.2 Recursos em runtime (host real, 33 containers)

| ID | Critério | Método |
|---|---|---|
| AC-RES-01 | RSS do processo ≤ **20 MiB** após 1h com 1 aba aberta (`docker stats`) | M |
| AC-RES-02 | Boot até `/healthz` 200 em < **100 ms** (sem contar o warming) | S |
| AC-RES-03 | Com 0 clientes por 60s: **zero** requests ao socket fora o `/events` aberto (contador interno exposto em log de debug ou `strace -f -e connect`) | S |
| AC-RES-04 | Com 1 cliente ativo: nenhuma chamada a `/containers/*/stats` enquanto houver cgroup disponível | S |
| AC-RES-05 | CPU média do `dockerd` em 30 min com a v3 é **≤ 50%** da medida com a v2 nas mesmas condições (mesma janela, 1 aba aberta) | M |
| AC-RES-06 | CPU do processo `homelab` < 1% em média com 1 aba aberta | M |
| AC-RES-07 | 10 abas abertas por 10 min não aumentam o RSS em mais de 5 MiB | M |

### 11.3 Frontend: peso e desempenho

| ID | Critério | Método |
|---|---|---|
| AC-WEB-01 | JS total da página ≤ **25 KB gzip** | S (`curl` + soma) |
| AC-WEB-02 | HTML de `/` ≤ **30 KB** sem compressão, com 33 containers | S |
| AC-WEB-03 | CSS ≤ **25 KB** sem compressão | S |
| AC-WEB-04 | Nenhum request a domínio externo (fontes, CDN) | T (Playwright: interceptar requests) |
| AC-WEB-05 | Lighthouse desktop: Performance ≥ 98, Accessibility ≥ 95 | M |
| AC-WEB-06 | Assets estáticos com `ETag` e `Cache-Control: public, max-age=31536000, immutable` (nomes com hash); `/` com `no-store` | S |
| AC-WEB-07 | Sem mudanças nos dados por 60s, o tráfego cliente↔servidor é só `: ping` | T |

### 11.4 API e paridade

| ID | Critério | Método |
|---|---|---|
| AC-API-01 | Para cada `GET` da seção 5, a resposta da v3 tem as mesmas chaves e tipos da v2 (diff de schema JSON) | S (`scripts/v3-checks/api-parity.sh`, v2 na :80 × v3 na :10003) |
| AC-API-02 | Métricas da v3 × v2 no mesmo instante: CPU/RAM/Temp do host com diferença ≤ 3 p.p.; storage idêntico | S |
| AC-API-03 | `cpuPct` por container dentro de ±1 p.p. do `docker stats --no-stream` (média de 5 amostras, containers com carga > 1%) | S |
| AC-API-04 | `memPct` por container dentro de ±0,5 p.p. do `docker stats` | S |
| AC-API-05 | Todos os casos de erro da tabela 10.3 retornam o status e a mensagem especificados | T (tabela de casos em `server_test.go`) |
| AC-API-06 | `ref` com `../`, `%2F`, espaço ou vazio → 400, sem chamada ao Docker | T |
| AC-API-07 | `PUT /api/prefs` com só `favorites` não altera as outras listas nem settings | T |
| AC-API-08 | Projetos: criar → editar → reordenar → apagar reproduz exatamente o estado esperado no SQLite | T |
| AC-API-09 | `HOMELAB_MOCK=1` sobe sem socket Docker nem `DB_PATH` gravável e serve todas as rotas | T |
| AC-API-10 | Depois de `POST /api/containers/{ref}/stop`, a próxima mensagem SSE já mostra o container parado (sem esperar o tick) | T |

### 11.5 Dados persistidos

| ID | Critério | Método |
|---|---|---|
| AC-DB-01 | A v3 abre uma **cópia** do `data/homepage.db` de produção e `GET /api/prefs` e `/api/projects` retornam o mesmo JSON da v2 | S |
| AC-DB-02 | Abrir o banco com a v3 e voltar para a v2 continua funcionando (rollback sem perda) | M |
| AC-DB-03 | Banco ausente → criado com todas as tabelas; banco sem `environment` → coluna adicionada com `dev` | T |
| AC-DB-04 | `DB_PATH` sem permissão → exit 1 com a mensagem da 10.7 | T |

### 11.6 Tempo real e collector

| ID | Critério | Método |
|---|---|---|
| AC-RT-01 | Ao conectar no `/api/stream`, o 1º `status` chega em < 200 ms | T |
| AC-RT-02 | `docker stop <x>` no host aparece na UI em ≤ **1s** (via `/events`, sem esperar tick) | M + T (mock de events) |
| AC-RT-03 | `docker restart <x>` gera exatamente **1** evento `restarted` no histórico | T |
| AC-RT-04 | Ação pela UI + evento do Docker não geram evento duplicado (dedupe 4s) | T |
| AC-RT-05 | `systemctl restart docker`: a v3 reconecta a `/events` sozinha e a UI volta a atualizar em ≤ 35s, sem reiniciar o app | M |
| AC-RT-06 | Cliente lento (não lê o stream) não bloqueia os outros nem faz a memória crescer | T |
| AC-RT-07 | O 33º cliente SSE simultâneo recebe 503 | T |
| AC-RT-08 | Pausa e retomada: depois de 30s sem clientes o collector pausa (log); ao abrir a página, retoma com tick imediato | T |
| AC-RT-09 | Container sem cgroup (simulado) cai no fallback `one-shot` e loga uma única vez | T |

### 11.7 Logs

| ID | Critério | Método |
|---|---|---|
| AC-LOG-01 | Log de container sem TTY sai limpo (sem bytes de header) inclusive com frames partidos entre chunks | T (fixture binária) |
| AC-LOG-02 | Log de container com TTY sai byte a byte igual ao `docker logs` | M |
| AC-LOG-03 | Log de stack: toda linha tem o prefixo `[nome]` e nenhuma linha é intercalada no meio | T |
| AC-LOG-04 | Fechar o modal encerra as conexões com o Docker em ≤ 1s (sem goroutine sobrando: `runtime.NumGoroutine` volta ao valor anterior) | T |
| AC-LOG-05 | Logs com `<script>` aparecem como texto, não executam | T (Playwright) |
| AC-LOG-06 | Com > 5.000 linhas, o DOM mantém só as 5.000 últimas e a rolagem segue fluida | M |

### 11.8 UI: paridade funcional (roteiro com Playwright no mock + manual no real)

| ID | Critério | Método |
|---|---|---|
| AC-UI-01 | Screenshot desktop 16:9 do mock visualmente equivalente a `docs/screenshots/dashboard-mock-desktop.png` (diferença de pixels ≤ 2%, excluindo relógio) | T |
| AC-UI-02 | Busca filtra por nome, imagem e stack; limpar a busca restaura a lista | T |
| AC-UI-03 | Ordenação faz o ciclo asc → desc → nenhuma, em cada coluna; com ordenação, a lista fica plana | T |
| AC-UI-04 | Favoritar, ocultar container, ocultar stack, colapsar stack e as 3 settings persistem após reload | T |
| AC-UI-05 | Start/stop/restart/delete de container e stop/restart/delete de stack: confirmação só no delete; toasts conforme 10.8 | T (mock) + M (container de teste real) |
| AC-UI-06 | Modal de meter: abre nos 4 kinds, prev/next funcionam, `cpu` atualiza a cada 5s, Esc fecha | T |
| AC-UI-07 | Projetos: criar, editar (nome, URL, ambiente, containers), apagar e reordenar por drag (mouse e touch emulado) | T |
| AC-UI-08 | **Foco preservado**: digitando na busca enquanto chegam 10 `status` seguidos, nenhum caractere se perde e o cursor não pula | T |
| AC-UI-09 | **Menu preservado**: menu de settings aberto continua aberto após 3 `status` | T |
| AC-UI-10 | **Dialog preservado**: formulário de projeto com texto digitado não perde conteúdo durante updates | T |
| AC-UI-11 | **Drag preservado**: arrastando um projeto, um `status` recebido não interrompe o drag | T |
| AC-UI-12 | Nenhum nó de lista é recriado quando só o CPU muda (o `MutationObserver` registra só mudanças de texto e atributo) | T |
| AC-UI-13 | Aba oculta fecha o `EventSource`; ao voltar, os dados atualizam em < 500 ms | T |
| AC-UI-14 | Servidor parado → banner "Reconectando…"; servidor de volta → banner some e dados voltam sem reload | T |
| AC-UI-15 | Layout funcional em 360px, 768px, 1280px e 2560px, sem scroll horizontal | T (screenshots) |
| AC-UI-16 | Prefs no `localStorage` legado são migradas para o servidor e as chaves são apagadas | T |
| AC-UI-17 | Navegação completa por teclado (Tab/Shift+Tab/Enter/Esc) em toolbar, menus, modais e ações | M |

### 11.9 Deploy e operação

| ID | Critério | Método |
|---|---|---|
| AC-OPS-01 | Deploy e atualização só via `docker compose -f infra/compose.production.yaml` (compose versionado no repositório) | M |
| AC-OPS-02 | Container sobe com `read_only`, `cap_drop: ALL`, `no-new-privileges`, uid 65532 e fica `healthy` | S (`docker inspect`) |
| AC-OPS-03 | Rollback para a v2 (trocar `image:` na stack) em < 2 min, com prefs e projetos intactos | M |
| AC-OPS-04 | `docker stop` encerra em < 5s (graceful), sem `SIGKILL` | S |
| AC-OPS-05 | 48h rodando na :10003 sem erro no log, sem crescimento de RSS > 5 MiB e sem restart | M |

### 11.10 Definition of Done (v3 pronta para o corte)

- [ ] Todos os critérios `T` e `S` passando no CI local (`make check`).
- [ ] Todos os critérios `M` executados, com resultado registrado em `docs/v3-acceptance.md`
      (data, valor medido, ok/nok).
- [ ] Nenhum critério nok sem decisão explícita (aceitar com justificativa ou corrigir).
- [ ] Tabela da seção 2 preenchida com os valores medidos e publicada no `README.md`.
- [ ] Backup de `data/homepage.db` feito antes do corte.

---

## 12. Fases

Branch: `v3`. Cada fase termina com commit e checagem objetiva.

### Fase 0: Setup (½ dia)
- [ ] `go mod init`, layout de diretórios, `cmd/homelab` respondendo `/healthz`.
- [ ] `web/` com esbuild + Tailwind CLI + idiomorph; `npm run build:web`.
- [ ] `infra/Dockerfile` multi-stage gerando imagem < 15 MB (Go não está instalado no host,
      então todo build roda em container; opcional: instalar Go localmente para dev).
- **Aceite**: AC-BLD-01, AC-BLD-02, AC-BLD-03, AC-BLD-06, AC-RES-02.

### Fase 1: Backend com paridade de API (1–1,5 dia)
- [ ] `docker/` (client, containers, ações, stacks, logs com demux).
- [ ] `store/` lendo o `homepage.db` **existente** (copiar para teste; schema + migrações).
- [ ] `metrics/host.go` (CPU, RAM, temp, discos/mounts, fstab) com saídas idênticas.
- [ ] `metrics/details.go` (`/api/meters/{kind}`).
- [ ] `mock/` para `HOMELAB_MOCK=1`.
- [ ] Todas as rotas da seção 5.
- [ ] `scripts/v3-checks/api-parity.sh` (diff de schema v2 × v3).
- **Aceite**: AC-API-01, AC-API-02, AC-API-05 a AC-API-09, AC-DB-01 a AC-DB-04,
  AC-LOG-01 a AC-LOG-04, AC-BLD-05.

### Fase 2: Coleta otimizada + SSE (1 dia)
- [ ] `metrics/cgroup.go` com fallback; conferir contra `docker stats` (±1 p.p.).
- [ ] `docker/events.go` + relist por evento.
- [ ] `hub/` + `/api/stream` + pausa sem clientes.
- [ ] Histórico de lifecycle a partir de eventos.
- **Aceite**: AC-API-03, AC-API-04, AC-API-10, AC-RES-03, AC-RES-04, AC-RT-01 a AC-RT-09.

### Fase 3: Frontend vanilla + idiomorph (2–3 dias)
- [ ] Template HTML com header, toolbar, painéis, overlays.
- [ ] Render de meters (+ gráficos de uso), stacks/containers (agrupado, flat, compact,
      truncate, ocultos, favoritos, colapso), histórico.
- [ ] Projetos: listar, criar, editar (nome, URL, ambiente, containers), apagar,
      reordenar por drag & drop.
- [ ] Ações de lifecycle com confirmação + toasts.
- [ ] Modal de logs (container e stack): streaming, copiar, limpar, barra de progresso
      de scroll.
- [ ] Modal de detalhe de meter (prev/next, refresh enquanto aberto).
- [ ] Settings: compact, truncate, vertical meters; tela cheia; relógio.
- [ ] Suíte Playwright em `web/tests/` rodando contra `HOMELAB_MOCK=1`.
- **Aceite**: AC-UI-01 a AC-UI-17, AC-LOG-05, AC-LOG-06, AC-WEB-04, AC-WEB-07.

### Fase 4: Enxugar CSS/fontes (½ dia)
- [ ] CSS ≤ 25 KB, 1 fonte woff2, ícones inline.
- **Aceite**: AC-WEB-01 a AC-WEB-06.

### Fase 5: Deploy + corte (½ dia)
- [ ] `chown` do `data/`, v3 na 10003 com dados reais, uso real por 1–2 dias.
- [ ] Checklist de paridade (todas as ações em container real de teste).
- [ ] Trocar porta para 80, parar stack/compose da v2.
- [ ] Remover código Next (seção 4), atualizar `README.md`, novo screenshot.
- **Aceite**: AC-OPS-01 a AC-OPS-05, AC-RES-01, AC-RES-05 a AC-RES-07, AC-DB-02, e a
  Definition of Done (11.10).

Estimativa total: **~6–7 dias** de trabalho.

---

## 13. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| CPU por cgroup diverge do `docker stats` | Mesma fórmula (Δusage/Δt); teste comparativo na Fase 2; fallback para `one-shot` |
| Caminho de cgroup diferente (cgroupfs, rootless, outro host) | Descoberta em 3 caminhos + fallback via API |
| `/events` cai (restart do dockerd) | Reconexão com backoff + relist completo ao reconectar + relist de segurança a cada 60s |
| Drag & drop de projetos (era React) | Pointer Events + `data-id`; testar touch |
| idiomorph casando nós errados em listas | `id` estável em todo item de lista (seção 3) |
| Permissão do SQLite com usuário nonroot | `chown 65532` antes do deploy; erro claro no boot se não gravar |
| Perda de prefs/projetos | Backup de `data/homepage.db` antes do corte; v3 só faz `CREATE IF NOT EXISTS` / `ALTER ADD COLUMN` |
| Proxy reverso bufferizando SSE | Header `X-Accel-Buffering: no` + flush por evento; ping 25s |

---

## 14. Fora de escopo (v3)

- Autenticação (continua sem auth, rede local).
- Multi-host / múltiplos endpoints Docker.
- Métricas históricas persistidas (o `usageHistory` continua em memória no cliente).
