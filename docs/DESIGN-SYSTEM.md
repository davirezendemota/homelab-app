# Design System — Homelab App

Documentação das decisões visuais, tokens e padrões de UI do dashboard de containers Docker. A interface combina **shadcn/ui** (estilo `base-nova`, cor base `neutral`) com CSS de domínio em `src/app/globals.css`.

## Stack e convenções

| Camada | Tecnologia |
|--------|------------|
| Framework | Next.js (App Router) |
| Estilo utilitário | Tailwind CSS v4 (`@import "tailwindcss"`) |
| Componentes | shadcn/ui + Base UI (`components.json`: `style: base-nova`) |
| Ícones | Lucide |
| Variantes | `class-variance-authority` (`cva`) |
| Merge de classes | `cn` (`@/lib/utils` / pacote `cn`) |
| Tema padrão | **Dark** (`<html class="dark">` em `src/app/layout.tsx`) |
| Idioma | `pt-BR` |

**Fonte da verdade dos tokens semânticos:** `src/app/globals.css` (`:root` e `.dark`).  
**Gráficos / SVG (métricas):** `src/lib/shadcn-theme.ts` (valores oklch alinhados ao tema dark).

---

## Fundamentos

### Filosofia visual

- Paleta **neutra em OKLCH** (hue 0°), sem viés azulado — estilo próximo ao GitHub dark / painel de infra.
- Superfícies em camadas: `background` → `card` / `surface-raised` → `muted` / `surface-inset`.
- Bordas discretas (`--border`), hover com `--accent` ou `--secondary`.
- Dados técnicos (clock, portas, imagens, logs, percentuais) em **JetBrains Mono**; UI geral em **Inter**, com **Geist** como `--font-sans` do Tailwind/shadcn.

### Tipografia

| Uso | Família | Onde |
|-----|---------|------|
| UI, títulos, labels | Inter (`--font-inter`) | `body` em `globals.css` |
| Sans do design system | Geist (`--font-sans`) | `layout.tsx` + `@theme inline` |
| Métricas, código, portas | JetBrains Mono (`--font-jetbrains`) | `.clock`, `.image-text`, `.log-view`, barras de CPU, etc. |

**Escala típica (dashboard):**

| Elemento | Tamanho | Peso | Notas |
|----------|---------|------|--------|
| `h1` | 28px (24px ≤560px) | 700 | `letter-spacing: -0.02em` |
| Título header island | 15px | 700 | Pill fixa no topo |
| Eyebrow / section label | 11–12px | 600 | Uppercase, `letter-spacing: 0.08–0.12em`, `muted-foreground` |
| Corpo / inputs | 13–14px | 400–600 | — |
| Valor de meter | 26px | 700 | — |
| Mono pequeno (eixos de chart) | 9–12px | 400–600 | — |

### Cores semânticas (CSS variables)

Tokens shadcn mapeados no `@theme inline` para classes Tailwind (`bg-background`, `text-muted-foreground`, `border-border`, etc.).

**Light (`:root`)** — disponível, mas a app inicia em dark:

| Token | Função |
|-------|--------|
| `--background` / `--foreground` | Canvas e texto principal |
| `--card` / `--card-foreground` | Painéis e cards |
| `--popover` | Dropdowns e menus flutuantes |
| `--primary` / `--primary-foreground` | Ações primárias, checkbox marcado |
| `--secondary` | Fundos secundários, chips |
| `--muted` / `--muted-foreground` | Fundos suaves e texto secundário |
| `--accent` | Hover em linhas e opções |
| `--destructive` | Erro / ações destrutivas (shadcn) |
| `--border` / `--input` / `--ring` | Contornos e foco |
| `--surface-raised` | Alias → `--card` (elevação leve) |
| `--surface-inset` | Alias → `--muted` (blocos internos) |
| `--chart-1` … `--chart-5` | Escala neutra para charts shadcn |
| `--sidebar-*` | Reservado para sidebar shadcn |

**Dark (`.dark`)** — tema em produção na UI:

- Background ~`oklch(0.145 0 0)`, cards ~`oklch(0.205 0 0)`.
- Bordas com alpha: `oklch(1 0 0 / 10%)`.
- Primary invertido (texto claro em botão escuro no light; no dark, primary claro sobre fundo escuro).

**Raio base:** `--radius: 0.625rem` (10px). Derivados Tailwind: `radius-sm` … `radius-4xl` (multiplicadores de `--radius`).

### Cores de domínio (status, saúde, métricas)

Paleta inspirada no GitHub / semáforo de infra (hex fixos no código e CSS):

| Significado | Cor | Uso |
|-------------|-----|-----|
| OK / running estável | `#3fb950` | Status dot, disco principal, meter baixo |
| OK claro (texto) | `#56d364` | Health healthy, live badge, homolog badge |
| Atenção | `#d29922` / `#e3b341` | Container recém-subido, health starting, CPU média, favorito |
| Erro / crítico | `#f85149` | Unhealthy, erros, CPU/temp/storage alto |
| Texto erro suave | `#ffb4ae` | Toasts e mensagens de erro |
| Neutro (parado) | `SHADCN.mutedForeground` | Container down, CPU 0% |

**Health check** (`healthStyle` em `src/lib/dashboard-view-model.ts`):

- `healthy` → verde `#56d364` + fundo `rgba(63,185,80,.10)`
- `starting` → amarelo `#e3b341` + fundo `rgba(210,153,34,.12)`
- `unhealthy` → vermelho `#f85149` + fundo `rgba(248,81,73,.12)`

**CPU bar** (`cpuBarColor`): parado/0% → muted; ≤50% → foreground; ≤85% → `#e3b341`; acima → `#f85149`.

**Meters de host** (`temperatureColor` / `meterColor` em `host-metrics.ts`): verde &lt;70%, amarelo 70–84%, vermelho ≥85% (CPU/RAM/storage); temperatura com limiares 70°C / 85°C.

**Discos adicionais** (`MOUNT_COLORS`): `#6cb6ff`, `#a371f7`, `#e3b341`, `#f778ba`, `#56d4dd`, `#ffa657` (rotação por mount).

**Ambiente de projeto** (badges em CSS):

- `dev` — neutro (`muted` + `border`)
- `homolog` — verde translúcido
- `producao` — vermelho/coral translúcido

---

## Layout e espaçamento

| Token / classe | Valor | Uso |
|----------------|-------|-----|
| `--dashboard-panel-gap` | 20px | Grid do dashboard e gap entre painéis |
| `.page` | padding `88px 20px 64px` | Área principal (espaço para header island) |
| `.wrap` | `max-width: 1320px` (1520px com `body.meters-vertical`) | Container central |
| `.dashboard-panel` | `border-radius: 16px`, padding `20px 22px 24px` | Seções Projetos / Métricas / Containers |
| `.dashboard-layout` | grid `1fr` + coluna `300–400px` | Métricas à direita (ou empilhado &lt;960px) |

### Header island

Barra fixa centralizada (`z-index: 45`): pill com `border-radius: 999px`, fundo `background` ~88% + `backdrop-filter: blur(14px)`, sombra forte. Botões icon 32×32, separador 1px `--border`.

### Breakpoints (CSS)

| Largura | Comportamento |
|---------|----------------|
| ≤960px | Layout de métricas em coluna única; toolbar empilhada; linhas de container em flex wrap |
| ≤640px | Header island wrap; mais padding-top na `.page` |
| ≤560px | Meters em 1 coluna; modais mais altos na viewport |

---

## Superfícies e padrões de componente (dashboard)

Estes blocos vivem principalmente em **classes CSS** (não em `components/ui`), para preservar paridade com o homepage original.

| Padrão | Classe(s) | Descrição |
|--------|-----------|-----------|
| Painel de seção | `.dashboard-panel`, `.dashboard-panel-eyebrow` | Card com borda 16px |
| Medidor | `.meter`, `.meter-bar`, `.meter-chart-wrap` | Card 12px, barra 6px, mini chart SVG |
| Linha de container | `.row` | Grid 7 colunas; hover `accent` |
| Stack | `.stack-block`, `.stack-head`, `.stack-name` | Título mono; ícone compose amarelo `#e3b341` |
| Busca | `.search-input` | Card bg, radius 10px, ícone à esquerda |
| Filtro / sort | `.sort-btn`, `.sort-btn.active` | Pill; ativo usa `primary` |
| Projeto | `.project-card`, `.project-env-badge--*` | Drag-and-drop; menu no hover |
| Modal legado | `.modal`, `.modal-backdrop` | Overlay blur; tamanhos `modal-sm` / `modal-md` |
| Toast | `.toast`, `.toast-success` / `-error` / `-info` | Canto inferior direito, `z-index: 60` |
| Erro inline | `.error` | Fundo vermelho translúcido |
| Log viewer | `.log-view` | Mono 12.5px, `pre-wrap` |

**Action groups:** `.action-group` — fundo `card`, borda, `border-radius: 9999px`; botões internos com opacidade 0.45 até hover/focus na linha.

**Estados “ocultos”:** `.row.is-hidden`, `.hidden-stacks` — opacidade ~0.42, sobe no hover.

---

## Componentes shadcn/ui

Diretório: `src/components/ui/`. Configuração: `components.json`.

| Componente | Arquivo | Variantes / notas |
|----------|---------|-------------------|
| Button | `button.tsx` | `default`, `outline`, `secondary`, `ghost`, `destructive`, `link`; sizes `xs`–`lg`, `icon*` |
| Badge | `badge.tsx` | Alinhado ao Button (primary, secondary, destructive, outline, ghost, link) |
| Card | `card.tsx` | Composição CardHeader / Title / Content / Footer |
| Input | `input.tsx` | Borda `input`, ring no focus |
| Checkbox | `checkbox.tsx` | + classe legada `.ui-checkbox` em prefs |
| Label | `label.tsx` | — |
| Select | `select.tsx` | `data-[size=sm|default]` |
| Toggle | `toggle.tsx` | — |
| Dialog | `dialog.tsx` | Usado no editor de projetos (footer `.project-editor-footer`) |
| Dropdown Menu | `dropdown-menu.tsx` | Menu de preferências no header (`.header-prefs-dropdown`) |

**Foco acessível:** `focus-visible:ring-3` + `ring-ring/50` (padrão shadcn nova).

**Botões de ícone do produto** (fora do CVA): `.header-icon-btn`, `.project-card-btn`, `.name-action-btn` — transição ~120ms em cor/fundo/borda.

---

## Motion e feedback

| Nome | Implementação |
|------|----------------|
| Pulse | `@keyframes pulse` — opacity 1 ↔ 0.35; dots de clock e live badge |
| Transições UI | `0.12s` ease (hover, borders, toasts) |
| Barras CPU | `width` / `background-color` `0.35s ease` |
| Toast enter/exit | `opacity` + `translateY(8px)`, `0.2s` |

**Cursor:** dentro de `.page`, elementos interativos usam `cursor: pointer`; disabled → `not-allowed`.

**Scrollbar:** fina no `html`; thumb com `color-mix` em `--border`.

---

## Preferências de usuário (classes no `body`)

Aplicadas via prefs persistidas (SQLite):

| Classe | Efeito |
|--------|--------|
| `compact-view` | Linhas de container mais densas; stacks em lista “flush” |
| `truncate-names` | `text-overflow: ellipsis` em `.name-text` |
| `meters-vertical` | Métricas em coluna lateral sticky; `max-width` maior no `.wrap` |

---

## Uso em código

### Tailwind + tokens

```tsx
<div className="rounded-lg border border-border bg-card text-card-foreground" />
```

### Gráficos e canvas (fora do CSS)

Importar `SHADCN` de `@/lib/shadcn-theme` para eixos, séries neutras ou estados inativos.

### Manter consistência

1. Novas cores de UI → preferir tokens `--*` / classes `bg-*`, `text-*`.
2. Cores de status/métricas → reutilizar helpers em `dashboard-view-model.ts` e `host-metrics.ts`.
3. Novos componentes genéricos → shadcn em `components/ui`; blocos específicos do dashboard → classes em `globals.css` com prefixo claro (`.dashboard-*`, `.project-*`).
4. Alterou `:root` / `.dark` → atualizar `shadcn-theme.ts` se algo consumir oklch fixo em TS.

---

## Referências rápidas de arquivo

| Arquivo | Conteúdo |
|---------|----------|
| `src/app/globals.css` | Tokens, tema, ~95% do layout dashboard |
| `src/app/layout.tsx` | Fontes, `dark`, metadata |
| `components.json` | Preset shadcn |
| `src/lib/shadcn-theme.ts` | Constantes oklch para charts |
| `src/lib/dashboard-view-model.ts` | Cores de status, CPU, dots |
| `src/lib/host-metrics.ts` | Cores de meters e storage |
