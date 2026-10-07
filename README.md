# Homelab Homepage (Next.js)

Versão em [Next.js](https://nextjs.org/) do [homelab-homepage](https://github.com/davirezendemota/homelab-homepage) original em Python.

Mesma UI e APIs (`/api/status`, `/api/prefs`, logs, métricas, ações em containers/stacks), com backend em TypeScript (Docker via socket Unix, preferências em SQLite).

## Desenvolvimento local

Requisitos: Node 22+, acesso ao socket Docker.

```sh
cd homelab-app
npm install
npm run dev
```

Abra `http://localhost:3000`. Ajuste `group_add` no `compose.yaml` conforme o GID do grupo `docker` no host (`getent group docker`).

## Docker Compose

Desenvolvimento (padrão — hot reload, código montado do host):

```sh
docker compose up -d --build
```

Porta publicada: **10000 → 3000** (container). Acesse `http://localhost:10000` (ou `http://homelab01:10000` na LAN).

Se você abrir pelo hostname da LAN (`http://homelab01`, etc.), o Next em modo dev só entrega o JavaScript se esse host estiver em `allowedDevOrigins` (já incluímos `homelab` e `homelab01`; ajuste `ALLOWED_DEV_ORIGINS` no `compose.yaml` se usar outro nome).

Produção (imagem buildada, sem bind mount do código), porta **80**:

```sh
docker compose -f infra/compose.production.yaml up -d --build
```


| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `LINK_HOST` | *(header da requisição)* | Hostname nos links das portas (`http://HOST:porta`). No compose está `homelab01` para bater com o host na LAN; use `homelab` ou `localhost` se abrir o painel só localmente. |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Socket da API Docker |
| `HOST_ROOT` | `/host` | Raiz do host montada (métricas de disco/temp) |
| `DB_PATH` | `/app/data/homepage.db` | SQLite de preferências |

## Estrutura

- `src/app/api/*` — rotas compatíveis com a versão Python
- `src/lib/*` — Docker, métricas, cache, prefs
- `src/lib/dashboard-client.ts` — UI extraída do `app.py` original
- `src/components/Dashboard.tsx` — hidratação da UI no cliente

## Licença

MIT
