# Homelab Bar (macOS)

App de menu bar para o **homelab-app**: métricas do host, containers e ações básicas, usando as mesmas rotas da web (`/api/status`, `/api/stream`).

A conexão prevista é **via Tailscale**: HTTP do Mac para o hostname MagicDNS do servidor (ex. `homelab01`), porta **80** onde o homelab-app roda em produção. O tráfego já vai criptografado na mesh; não use exposição pública da API.

Modo alternativo **SSH tunnel** (host ainda pode ser o nome Tailscale) — ver Ajustes.

Estrutura inspirada no [Deskmon](https://github.com/neur0map/deskmon) (MIT); o túnel SSH opcional reutiliza Citadel/NIO.

## Requisitos

- macOS 15+ (Sequoia) para **rodar** o app
- [Tailscale](https://tailscale.com) instalado e logado no Mac e no servidor
- homelab-app em execução no servidor (porta 80 no host)

Não é preciso instalar Xcode: o binário é gerado no **GitHub Actions** (ver abaixo).

## Tailscale

1. No servidor (`homelab01`), o container publica `80:3000` — a API fica em `http://<host-tailscale>/api/...`.
2. No Mac, confira resolução: `ping homelab01` ou o FQDN do tailnet.
3. No admin do Tailscale, garanta que o Mac pode alcançar a máquina (ACL padrão costuma permitir).
4. No Homelab Bar: host = nome MagicDNS, modo **Tailscale**, porta HTTP **80**.

Teste rápido no Mac:

```bash
curl -sS "http://homelab01/healthz"
curl -sS "http://homelab01/api/status" | head -c 200
```

## Baixar build (CI)

1. Abra o repo no GitHub → **Actions** → workflow **Homelab Bar**.
2. No run mais recente em `main`, baixe o artefato **`HomelabBar-Debug`** (zip).
3. Descompacte e abra `HomelabBar.app`.

**Primeira execução:** o app não é assinado com Developer ID. Em **Ajustes do Sistema → Privacidade e Segurança**, use **Abrir mesmo assim** (ou clique com o botão direito → Abrir).

Para disparar um build manual: **Actions → Homelab Bar → Run workflow**.

## Desenvolvimento (opcional, com Xcode)

```bash
open mac/HomelabBar.xcodeproj   # ou ./mac/build.sh
```

## Primeiro uso

1. Ícone na menu bar → **Ajustes…**
2. Perfil padrão `homelab01` já vem com modo Tailscale — ajuste o host se o MagicDNS for outro.
3. **Conectar agora** (com Tailscale ativo no Mac).

## Layout

```
mac/
├── HomelabBar.xcodeproj
└── HomelabBar/
    ├── HomelabBarApp.swift
    ├── Models/
    ├── Services/      # API, sessão, SSH (opcional)
    └── Views/
```
