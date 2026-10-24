// Render em string HTML — porta de DashboardHeader/Toolbar/Live/Projects/ContainerHistory (v2).
// Cada função é pura: recebe o estado e devolve HTML; o main.ts aplica com idiomorph.
import {
  CONTAINER_COLUMNS,
  containerTableInlineStyle,
  normalizeColumnWidths,
  type ColumnWidths,
} from "./container-columns";
import * as I from "./icons";
import * as UI from "./ui";
import { esc } from "./ui";
import type { AgentSession, ContainerRow, LifecycleEvent, Meter, PagePayload, Project, StorageMount } from "./types";
import {
  SHADCN,
  buildLists,
  decorate,
  dotStyle,
  filteredRows,
  formatPct,
  isContainerRunning,
  isHiddenByName,
  isStackCollapsed,
  portHref,
  stackKey,
  usageMetricBadgeStyle,
  type DashboardPrefsSnapshot,
  type DecoratedContainer,
  type StackBlock,
} from "./view-model";

export type ChartPoint = { t: number; v: number };

export type ViewState = {
  data: PagePayload;
  prefs: DashboardPrefsSnapshot;
  projects: Project[];
  projectsError: string | null;
  error: string | null;
  clock: string;
  fullscreen: boolean;
  fullscreenEnabled: boolean;
  openMenu: string | null;
  drag: { id: string | null; over: string | null };
  charts: Record<string, ChartPoint[]>;
};

const GITHUB_REPO_URL = "https://github.com/davirezendemota/homelab-app";

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Header ──────────────────────────────────────────────────────────────────

function renderHeader(s: ViewState): string {
  const fsLabel = s.fullscreen ? "Sair da tela cheia" : "Tela cheia";
  const enter = s.fullscreen ? I.MAXIMIZE.replace("fullscreen-enter-icon size-4", "fullscreen-enter-icon hidden size-4") : I.MAXIMIZE;
  const exit = s.fullscreen ? I.MINIMIZE.replace("fullscreen-exit-icon hidden size-4", "fullscreen-exit-icon size-4") : I.MINIMIZE;
  const fsBtn = s.fullscreenEnabled
    ? `<button type="button" data-slot="button" id="fullscreen-toggle" title="${fsLabel}" aria-label="${fsLabel}" class="${UI.BTN_GHOST_ICON_SM}">${enter}${exit}</button>`
    : "";
  const settingsOpen = s.openMenu === "settings";
  return `<div class="header-island-wrap"><header class="header-island border-border bg-background/80 backdrop-blur-md" role="banner">`
    + `<h1 class="header-island-title">Containers ativos</h1><span class="header-island-sep" aria-hidden="true"></span>`
    + `<div class="clock header-island-clock"><span class="clock-dot"></span>Atualizado <span id="clock">${esc(s.clock)}</span></div>`
    + `<div class="header-island-actions">${fsBtn}`
    + `<button type="button" data-slot="dropdown-menu-trigger" data-menu="settings" title="Configurações" aria-label="Configurações" aria-haspopup="menu" aria-expanded="${settingsOpen}" class="${UI.BTN_GHOST_ICON_SM}">${I.SETTINGS}</button>`
    + `<a href="${GITHUB_REPO_URL}" target="_blank" rel="noopener noreferrer" role="button" data-slot="button" title="Repositório no GitHub" aria-label="Repositório no GitHub" class="${UI.BTN_GHOST_ICON_SM}">${I.GITHUB}</a>`
    + `</div></header></div>`;
}

function checkbox(id: string, checked: boolean, extra = ""): string {
  return `<span role="checkbox" id="${id}" aria-checked="${checked}" tabindex="0" data-slot="checkbox" ${checked ? "data-checked" : "data-unchecked"} class="${UI.CHECKBOX}${extra ? " " + extra : ""}">`
    + (checked ? `<span data-slot="checkbox-indicator" class="${UI.CHECKBOX_INDICATOR}">${I.CHECK}</span>` : "")
    + `</span>`;
}

export function renderSettingsMenu(s: ViewState): string {
  const { compactView, truncateNames } = s.prefs.settings;
  const option = (key: string, id: string, checked: boolean, label: string, hint: string) =>
    `<label class="settings-option header-prefs-option" for="${id}" data-pref="${key}">${checkbox(id, checked, "mt-0.5")}`
    + `<span class="settings-option-text"><span class="settings-option-label">${label}</span><span class="settings-option-hint">${hint}</span></span></label>`;
  return `<p class="header-prefs-title">Preferências</p><div class="header-prefs-list">`
    + option("compactView", "pref-compact-view", compactView, "Visualização compacta", "Linhas mais densas, com containers agrupados por stack")
    + option("truncateNames", "pref-truncate-names", truncateNames, "Truncar nome do container", "Exibe reticências quando o nome não couber na coluna")
    + `</div>`;
}

// ── Projetos ────────────────────────────────────────────────────────────────

export function environmentLabel(env: string): string {
  if (env === "homolog") return "Homolog";
  if (env === "producao") return "Produção";
  return "Dev";
}

function stackDisplayName(stack: string) {
  return stack === "sem stack" ? "Sem stack" : stack;
}

function groupContainersByStack(names: string[], stackByName: Map<string, string>) {
  const order: string[] = [];
  const map = new Map<string, string[]>();
  for (const name of names) {
    const stack = stackByName.get(name) ?? "sem stack";
    if (!map.has(stack)) {
      map.set(stack, []);
      order.push(stack);
    }
    map.get(stack)!.push(name);
  }
  order.sort((a, b) => {
    if (a === "sem stack") return 1;
    if (b === "sem stack") return -1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
  return order.map((stack) => ({ stack, names: map.get(stack)! }));
}

function renderProjectCard(p: Project, s: ViewState, statusByName: Map<string, string>, stackByName: Map<string, string>): string {
  const link = p.accessUrl.trim();
  const env = environmentLabel(p.environment);
  const dragging = s.drag.id === p.id;
  const over = s.drag.over === p.id && s.drag.id !== p.id;
  const menuOpen = s.openMenu === `project:${p.id}`;
  const title = link
    ? `<a href="${esc(link)}" class="project-card-title-link" target="_blank" rel="noopener noreferrer" draggable="false" title="Abrir ${esc(link)}">${esc(p.name)}</a>`
    : `<span title="${esc(p.name)}">${esc(p.name)}</span>`;
  const body = p.containers.length === 0
    ? `<p class="project-card-empty">Nenhum container.</p>`
    : groupContainersByStack(p.containers, stackByName).map(({ stack, names }) =>
      `<div class="project-stack-block"><div class="project-stack-label" title="${esc(stackDisplayName(stack))}">${esc(stackDisplayName(stack))}</div><div class="project-stack-containers">`
      + names.map((name) => {
        const dot = dotStyle(statusByName.get(name) ?? "unknown");
        return `<div class="project-container-line" title="${esc(name)}"><span class="status-dot" style="background:${dot.dot};box-shadow:0 0 0 3px ${dot.glow}"></span><span class="project-container-name">${esc(name)}</span></div>`;
      }).join("")
      + `</div></div>`).join("");
  return `<div id="p-${esc(p.id)}" data-slot="card" data-size="default" data-project-id="${esc(p.id)}" class="${UI.PROJECT_CARD}${dragging ? " is-dragging" : ""}${over ? " is-drag-over" : ""}" draggable="true" title="Arrastar para reordenar">`
    + `<div data-slot="card-header" class="${UI.PROJECT_CARD_HEAD}"><div class="project-card-title-block">`
    + `<span data-slot="badge" data-variant="outline" class="${UI.BADGE_OUTLINE} project-env-badge project-env-badge--${esc(p.environment)}" title="Ambiente: ${env}">${env}</span>`
    + `<h2 class="project-card-title">${title}</h2></div>`
    + `<button type="button" data-slot="dropdown-menu-trigger" data-menu="project:${esc(p.id)}" draggable="false" aria-haspopup="menu" aria-expanded="${menuOpen}" aria-label="Menu do projeto ${esc(p.name)}" class="${UI.BTN_GHOST_ICON_SM} project-card-btn cursor-pointer project-card-menu-trigger">${I.ELLIPSIS}</button>`
    + `</div><div data-slot="card-content" class="project-card-body p-0">${body}</div></div>`;
}

function renderProjects(s: ViewState): string {
  const statusByName = new Map<string, string>();
  const stackByName = new Map<string, string>();
  for (const c of s.data.containers) {
    statusByName.set(c.name, c.status);
    stackByName.set(c.name, c.stack);
  }
  return `<section class="dashboard-panel dashboard-panel--projects" aria-label="Projetos"><section class="projects-section" aria-label="Projetos">`
    + `<div class="projects-section-head"><div><span class="projects-eyebrow">Projetos</span><p class="projects-hint">Agrupe containers por contexto — arraste o card para reordenar.</p></div>`
    + `<button type="button" data-slot="button" data-project-new class="${UI.BTN_DEFAULT} project-new-btn">${I.PLUS}Novo projeto</button></div>`
    + (s.projectsError ? `<div class="project-section-error">${esc(s.projectsError)}</div>` : "")
    + `<div class="projects-grid" id="projects-grid">${s.projects.map((p) => renderProjectCard(p, s, statusByName, stackByName)).join("")}</div>`
    + `</section></section>`;
}

// ── Meters ──────────────────────────────────────────────────────────────────

function expandBtn(m: Meter): string {
  if (!m.detailKey) return "";
  return `<button type="button" class="meter-expand-btn" data-meter-detail="${esc(m.detailKey)}" data-meter-label="${esc(m.label)}" title="Expandir ${esc(m.label)}" aria-label="Expandir detalhes de ${esc(m.label)}">${I.EXPAND}</button>`;
}

function meterTop(m: Meter): string {
  return `<div class="meter-top"><span class="meter-label">${esc(m.label)}</span>${m.showSub ? `<span class="meter-sub">${esc(m.sub)}</span>` : ""}</div>`;
}

function storageRow(row: StorageMount): string {
  return `<div class="storage-row" data-used-gb="${esc(row.used_gb)}" data-total-gb="${esc(row.total_gb)}"><span class="storage-label" title="${esc(row.path)}">${esc(row.label)}</span>`
    + `<div class="storage-bar"><span style="width:${esc(row.pct)}%;background:${esc(row.color)}"></span></div><span class="storage-pct">${esc(row.pct)}%</span></div>`;
}

function agentRow(a: AgentSession): string {
  // Logo do agente + só o nome da pasta atual; subagents (agente iniciado por outro) ganham selo e recuo.
  const folder = a.cwd === "~" ? "~" : a.cwd.split("/").filter(Boolean).pop() || `PID ${a.pid}`;
  const sub = a.parent ? `<span class="agent-sub-badge">subagent</span>` : "";
  const procs = a.procs > 1 ? ` (${a.procs} processos)` : "";
  const title = [a.label, a.parent ? "subagent" : "", folder, a.uptime, `PID ${a.pid}`].filter(Boolean).join(" · ");
  return `<div class="agent-row${a.parent ? " agent-row--sub" : ""}" id="agent-${esc(a.id)}" title="${esc(title)}${esc(procs)}">`
    + `<span class="agent-logo agent-logo--${esc(a.kind)}">${I.AGENT_LOGOS[a.kind] ?? ""}</span>`
    + `<div class="agent-info"><span class="agent-name"><span class="agent-folder">${esc(folder)}</span>${sub}</span><span class="agent-meta">${esc(a.uptime)}</span></div>`
    + `<span class="agent-value" style="color:${esc(a.color)}">${esc(a.cpuDisplay)}</span>`
    + `<span class="agent-value">${esc(a.memDisplay)}</span></div>`;
}

// Painel próprio: acima do monitor na lateral, abaixo dele no layout em linha.
function renderAgentsPanel(m: Meter | undefined): string {
  if (!m) return "";
  const sessions = (m.sessions as AgentSession[] | undefined) ?? [];
  const body = sessions.length === 0
    ? `<p class="agent-empty">Nenhuma sessão ativa</p>`
    : `<div class="agent-head" aria-hidden="true"><span>Sessão</span><span>CPU</span><span>RAM</span></div>`
      + `<div class="agent-list">${sessions.map(agentRow).join("")}</div>`;
  return `<section class="dashboard-panel dashboard-panel--agents" id="agents-panel" aria-label="Agent Sessions">`
    + `<div class="dashboard-panel-head dashboard-panel-head--agents"><span class="dashboard-panel-eyebrow">Agent Sessions</span>`
    + `<span class="agents-panel-sub">${esc(m.sub)}</span></div>${body}</section>`;
}

function chartSvgBody(points: ChartPoint[], color: string): string {
  if (!points.length) return "";
  const W = 200;
  const H = 48;
  const tMin = points[0]!.t;
  const tMax = points[points.length - 1]!.t;
  const tSpan = Math.max(tMax - tMin, 1);
  const xAt = (t: number) => ((t - tMin) / tSpan) * W;
  const yAt = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * H;
  const coords = points.map((p) => [xAt(p.t), yAt(p.v)] as const);
  const linePts = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const firstX = coords[0]![0].toFixed(1);
  const lastX = coords[coords.length - 1]![0].toFixed(1);
  const baseY = H.toFixed(1);
  const y50 = yAt(50).toFixed(1);
  const c = esc(color);
  return `<line x1="0" y1="${y50}" x2="${W}" y2="${y50}" stroke="${SHADCN.border}" stroke-width="1"/>`
    + `<polygon points="${firstX},${baseY} ${linePts} ${lastX},${baseY}" fill="${c}" fill-opacity="0.14"/>`
    + `<polyline points="${linePts}" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function chartSection(key: string, color: string, points: ChartPoint[]): string {
  const t0 = points.length ? timeLabel(points[0]!.t) : "";
  const t1 = points.length ? timeLabel(points[points.length - 1]!.t) : "";
  return `<div class="meter-chart-wrap"><div class="meter-chart-axis" aria-hidden="true"><span>100</span><span>0</span></div>`
    + `<svg class="meter-chart" data-chart="${esc(key)}" viewBox="0 0 200 48" preserveAspectRatio="none" role="img" aria-label="Histórico de uso">${chartSvgBody(points, color)}</svg>`
    + `<div class="meter-chart-times" data-chart-times="${esc(key)}" aria-hidden="true"><span>${t0}</span><span>${t1}</span></div></div>`;
}

function renderMeter(m: Meter, s: ViewState): string {
  const color = esc(m.color);
  if (m.type === "storage") {
    const main = m.main as StorageMount | undefined;
    const mounts = (m.mounts as StorageMount[] | undefined) ?? [];
    return `<div class="meter storage" id="m-${esc(m.detailKey ?? m.label)}">${expandBtn(m)}${meterTop(m)}`
      + `<div class="meter-value" style="color:${color};margin-top:6px">${esc(m.display)}</div>`
      + `<div class="storage-bars">${main ? storageRow(main) : ""}${mounts.map(storageRow).join("")}</div></div>`;
  }
  const value = m.showBar
    ? `<div class="meter-value-row"><div class="meter-value" style="color:${color}">${esc(m.display)}</div><div class="meter-bar"><span style="width:${esc(m.barWidth)};background:${color}"></span></div></div>`
    : `<div class="meter-value" style="color:${color};margin-top:6px">${esc(m.display)}</div>`;
  const chart = m.showChart && m.chartKey ? chartSection(m.chartKey, m.color, s.charts[m.chartKey] ?? []) : "";
  const caption = m.showCaption ? `<div class="meter-caption">${esc(m.caption)}</div>` : "";
  return `<div class="meter" id="m-${esc(m.detailKey ?? m.label)}">${expandBtn(m)}${meterTop(m)}${value}${chart}${caption}</div>`;
}

function renderMetersColumn(s: ViewState): string {
  const vertical = s.prefs.settings.verticalMeters;
  const label = vertical ? "Exibir monitor em linha (horizontal)" : "Exibir monitor na lateral (vertical)";
  const meters = `<section class="dashboard-panel dashboard-panel--meters" aria-label="Monitor de recursos">`
    + `<div class="dashboard-panel-head dashboard-panel-head--meters"><span class="dashboard-panel-eyebrow">Monitor de recursos</span>`
    + `<button type="button" data-slot="button" id="meters-layout-toggle" title="${label}" aria-label="${label}" aria-pressed="${vertical}" class="${UI.BTN_GHOST_ICON_SM} meters-layout-toggle">${I.LAYOUT_PANEL_LEFT}</button></div>`
    + `<div class="meters" id="meters">${s.data.meters.filter((m) => m.type !== "agents").map((m) => renderMeter(m, s)).join("")}</div></section>`;
  const agents = renderAgentsPanel(s.data.meters.find((m) => m.type === "agents"));
  const top = vertical ? agents + meters : meters + agents;
  return `<div class="dashboard-meters-stack">${top}${renderHistory(s.data.containerHistory ?? [])}</div>`;
}

// ── Histórico ───────────────────────────────────────────────────────────────

function renderHistory(items: LifecycleEvent[]): string {
  const body = items.length === 0
    ? `<p class="container-history-empty">Nenhum container ligado ou reiniciado recentemente.</p>`
    : `<ul class="container-history-list">` + items.map((ev) =>
      `<li class="container-history-item" id="h-${ev.at}-${esc(ev.name)}-${ev.kind}"><span class="container-history-kind container-history-kind--${ev.kind}">${ev.kind === "restarted" ? "Reiniciado" : "Ligado"}</span>`
      + `<span class="container-history-name" title="${esc(ev.name)}">${esc(ev.name)}</span>`
      + `<span class="container-history-meta"><span class="container-history-stack">${esc(stackDisplayName(ev.stack))}</span>`
      + `<time class="container-history-time" datetime="${new Date(ev.at).toISOString()}">${timeLabel(ev.at)}</time></span></li>`).join("")
      + `</ul>`;
  return `<section class="dashboard-panel dashboard-panel--container-history" aria-label="Histórico de containers">`
    + `<div class="dashboard-panel-head dashboard-panel-head--container-history"><span class="dashboard-panel-eyebrow">Histórico de containers</span></div>${body}</section>`;
}

// ── Containers ──────────────────────────────────────────────────────────────

function columnWidthsFromPrefs(prefs: DashboardPrefsSnapshot): ColumnWidths {
  return normalizeColumnWidths(prefs.settings.containerColumnWidths);
}

function renderContainerTableHead(): string {
  const cells = CONTAINER_COLUMNS.map((col, i) => {
    const namePad = col.id === "name" ? `<span class="ct-th-name-pad" aria-hidden="true"></span>` : "";
    const label = col.label
      ? `<span class="ct-th-label">${esc(col.label)}</span>`
      : `<span class="ct-th-label ct-th-label--icon" aria-hidden="true">${I.ELLIPSIS}</span>`;
    const resize = i < CONTAINER_COLUMNS.length - 1
      ? `<span class="col-resize-handle" data-col-resize="${i}" role="separator" aria-orientation="vertical" aria-label="Redimensionar coluna ${esc(col.label || "ações")}"></span>`
      : "";
    return `<div class="ct-th ct-th--${col.id}" role="columnheader"><span class="ct-th-inner">${namePad}${label}${resize}</span></div>`;
  }).join("");
  return `<div class="ct-row ct-head" role="row">${cells}</div>`;
}

function wrapContainerTable(rowsHtml: string, widths: ColumnWidths): string {
  return `<div class="container-table" role="table" style="${containerTableInlineStyle(widths)}">${renderContainerTableHead()}${rowsHtml}</div>`;
}

function usageCell(c: DecoratedContainer): string {
  const running = isContainerRunning(c.status);
  const ramPct = running ? (c.memPct ?? 0) : null;
  const cpuPct = running ? (c.cpuPct ?? 0) : null;
  const ramLabel = running && ramPct != null ? formatPct(ramPct) : "—";
  const cpuLabel = running && cpuPct != null ? formatPct(cpuPct) : "—";
  const title = running ? `RAM ${ramLabel} · CPU ${cpuLabel}` : "Container parado";
  const ram = usageMetricBadgeStyle(ramPct, running);
  const cpu = usageMetricBadgeStyle(cpuPct, running);
  return `<div class="container-usage" title="${esc(title)}">`
    + `<span class="usage-badge" style="color:${ram.color};background:${ram.bg}">RAM <span class="usage-badge-value">${ramLabel}</span></span>`
    + `<span class="usage-badge" style="color:${cpu.color};background:${cpu.bg}">CPU <span class="usage-badge-value">${cpuLabel}</span></span></div>`;
}

function actionBtn(c: DecoratedContainer, action: string, title: string, icon: string, extra = ""): string {
  return `<button type="button" class="name-action-btn${extra}" data-action="${action}" data-id="${esc(c.id)}" data-name="${esc(c.name)}" title="${title}" aria-label="${title} ${esc(c.name)}">${icon}</button>`;
}

function renderRow(c: DecoratedContainer, s: ViewState, keyPrefix: string): string {
  const hidden = isHiddenByName(c.name, s.data.containers, s.prefs);
  const running = isContainerRunning(c.status);
  const isFav = s.prefs.favorites.includes(c.name);
  const ports = c.noPorts
    ? `<span class="no-ports">—</span>`
    : c.ports.map((p) => `<a class="port-link" href="${esc(portHref(s.data.host, p))}" target="_blank" rel="noopener">:${p}</a>`).join("");
  return `<div class="ct-row ct-data${hidden ? " is-hidden" : ""}" id="${keyPrefix}-c-${esc(c.name)}" role="row">`
    + `<div class="ct-cell row-name" role="cell"><span class="status-dot" style="background:${c.dotColor};box-shadow:0 0 0 3px ${c.dotGlow}"></span><span class="name-text" title="${esc(c.name)}">${esc(c.name)}</span></div>`
    + `<div class="ct-cell image-text" role="cell" title="${esc(c.image)}">${esc(c.image)}</div>`
    + `<div class="ct-cell status-cell" role="cell"><span class="status-pill" style="color:${c.statusColor};background:${c.statusBg}">${esc(c.status)}</span></div>`
    + `<div class="ct-cell container-actions" role="cell"><div class="action-group">`
    + (running ? actionBtn(c, "stop", "Parar", I.STOP) : actionBtn(c, "start", "Iniciar", I.PLAY))
    + actionBtn(c, "restart", "Reiniciar", I.RESTART)
    + actionBtn(c, "delete", "Apagar", I.TRASH, " delete-btn")
    + `</div></div><div class="ct-cell ports" role="cell">${ports}</div><div class="ct-cell row-actions" role="cell">`
    + `<button type="button" class="fav-btn${isFav ? " is-on" : ""}" data-fav="${esc(c.name)}" title="${isFav ? "Remover dos favoritos" : "Favoritar"}" aria-label="${isFav ? `Remover ${esc(c.name)} dos favoritos` : `Favoritar ${esc(c.name)}`}" aria-pressed="${isFav}">${I.STAR}</button>`
    + `<button type="button" class="hide-btn${hidden ? " is-on" : ""}" data-hide="${esc(c.name)}" title="${hidden ? "Mostrar container" : "Esconder container"}" aria-label="${hidden ? `Mostrar ${esc(c.name)}` : `Esconder ${esc(c.name)}`}" aria-pressed="${hidden}">${I.HIDE}</button>`
    + `<button type="button" class="logs-btn" data-logs="${esc(c.id)}" data-name="${esc(c.name)}" title="Ver logs" aria-label="Ver logs de ${esc(c.name)}">${I.LOGS}</button>`
    + `</div><div class="ct-cell" role="cell">${usageCell(c)}</div></div>`;
}

function stackBtn(stack: StackBlock, action: string, title: string, icon: string, extra = ""): string {
  return `<button type="button" class="name-action-btn stack-action-btn${extra}" data-stack-action="${action}" data-stack-name="${esc(stack.name)}" title="${title}" aria-label="${title} ${esc(stack.name)}">${icon}</button>`;
}

function renderStack(stack: StackBlock, s: ViewState, showStackHide: boolean, section: string): string {
  const collapsed = stack.showTitle && isStackCollapsed(stack, new Set(s.prefs.collapsedStacks));
  const stackHidden = !stack.isFavorites && s.prefs.hiddenStacks.includes(stack.name);
  const key = stackKey(stack);
  const running = stack.containers.some((c) => isContainerRunning(c.status));
  const rowPrefix = `${section}-${key}`;
  const widths = columnWidthsFromPrefs(s.prefs);
  const rows = stack.containers.map((c) => renderRow(c, s, rowPrefix)).join("");
  let head = "";
  if (stack.showTitle) {
    const nameLabel = stack.isFavorites ? "Favoritos" : esc(stack.name);
    const swarmBadge = stack.isSwarm
      ? `<span data-slot="badge" data-variant="outline" class="${UI.BADGE_OUTLINE} stack-swarm-badge" title="Docker Swarm">Swarm</span>`
      : "";
    head = `<div class="stack-head"><span class="stack-title"><span class="stack-name${stack.isFavorites ? " stack-name-icon" : ""}" title="${nameLabel}" aria-label="${nameLabel}">${stack.isFavorites ? I.STAR : esc(stack.name)}</span>${swarmBadge}</span>`
      + `<div class="stack-meta"><span class="stack-count">${stack.count}</span>`
      + `<button type="button" class="stack-collapse-btn" data-collapse-stack="${esc(key)}" title="${collapsed ? "Expandir stack" : "Comprimir stack"}" aria-label="${collapsed ? "Expandir" : "Comprimir"} stack ${esc(stack.name)}" aria-expanded="${!collapsed}">${collapsed ? I.CHEVRON_DOWN : I.CHEVRON_UP}</button>`
      + (showStackHide && !stack.isFavorites
        ? `<button type="button" class="hide-btn stack-hide-btn${stackHidden ? " is-on" : ""}" data-hide-stack="${esc(stack.name)}" title="${stackHidden ? "Mostrar stack" : "Esconder stack"}" aria-label="${stackHidden ? "Mostrar" : "Esconder"} stack ${esc(stack.name)}" aria-pressed="${stackHidden}">${I.HIDE}</button>`
        : "")
      + (!stack.isFavorites
        ? `<div class="action-group stack-actions">`
          + (running ? stackBtn(stack, "stop", "Parar stack", I.STOP) : "")
          + `<button type="button" class="name-action-btn stack-action-btn" data-stack-logs="${esc(stack.name)}" title="Ver logs da stack" aria-label="Ver logs da stack ${esc(stack.name)}">${I.LOGS}</button>`
          + stackBtn(stack, "restart", "Reiniciar stack", I.RESTART)
          + stackBtn(stack, "delete", "Apagar stack", I.TRASH, " delete-btn")
          + `</div>`
        : "")
      + `</div></div>`;
  }
  const table = wrapContainerTable(rows, widths);
  const scrollWrap = (inner: string, extraClass = "") =>
    `<div class="container-table-scroll${extraClass ? ` ${extraClass}` : ""}">${inner}</div>`;
  const body = scrollWrap(table, `stack-body${stack.showTitle && collapsed ? " hidden" : ""}`);
  return `<div class="stack-block${collapsed ? " is-collapsed" : ""}" id="${section}-s-${esc(key)}">${head}${body}</div>`;
}

function renderToolbar(s: ViewState, hiddenCount: number): string {
  const { query, sortKey, sortDir, showHidden } = s.prefs.view;
  const sortBtns = (["status", "port", "name"] as const).map((key) => {
    const active = sortKey === key;
    const label = key === "status" ? "Status" : key === "port" ? "Porta" : "Nome";
    return `<button type="button" data-slot="button" data-sort="${key}" class="${active ? UI.BTN_SORT_ACTIVE : UI.BTN_SORT}">${label}${active ? `<span class="arrow">${sortDir === 1 ? "▲" : "▼"}</span>` : ""}</button>`;
  }).join("");
  const hiddenLabel = showHidden ? "Ocultar containers escondidos" : `Mostrar containers escondidos (${hiddenCount})`;
  const toggle = hiddenCount > 0
    ? `<button type="button" data-slot="toggle" id="hidden-show-toggle" title="${hiddenLabel}" aria-label="${hiddenLabel}" aria-pressed="${showHidden}" ${showHidden ? "data-pressed" : ""} class="${UI.TOGGLE_HIDDEN}${showHidden ? " active" : ""}">${I.EYE_OFF}</button>`
    : "";
  return `<div class="toolbar"><div class="search-wrap relative">${I.SEARCH}`
    + `<input id="q" data-slot="input" placeholder="Filtrar por nome, imagem ou stack…" autocomplete="off" class="${UI.INPUT} search-input h-9 pl-9" type="search" value="${esc(query)}"></div>`
    + `<div class="sort"><span class="sort-label">Ordenar</span>${sortBtns}${toggle}</div></div>`;
}

function renderContainers(s: ViewState): string {
  const { data, prefs } = s;
  const rows = filteredRows(data.containers, prefs.view.query);
  const lists = buildLists(data.containers, prefs);
  const hasVisible = lists.flat ? (lists.flatRows?.length ?? 0) > 0 : (lists.visibleStacks?.length ?? 0) > 0;
  const showHiddenList = !lists.flat && prefs.view.showHidden && (lists.hiddenStacks?.length ?? 0) > 0;
  const showEmpty = !hasVisible && !showHiddenList;

  const widths = columnWidthsFromPrefs(prefs);
  let stacks = "";
  if (hasVisible) {
    stacks = lists.flat
      ? `<div class="flat-list stack-body container-table-scroll">${wrapContainerTable((lists.flatRows ?? []).map((c: ContainerRow) => renderRow(decorate(c), s, "flat")).join(""), widths)}</div>`
      : (lists.visibleStacks ?? []).map((st) => renderStack(st, s, true, "v")).join("");
  }
  const hidden = showHiddenList ? (lists.hiddenStacks ?? []).map((st) => renderStack(st, s, true, "h")).join("") : "";
  let empty = "";
  if (showEmpty) {
    empty = rows.length === 0 || !prefs.view.query.trim()
      ? "Nenhum container."
      : `Nenhum container corresponde a &quot;${esc(prefs.view.query)}&quot;.`;
  }
  const error = s.error ?? data.error;
  return `<section class="dashboard-panel dashboard-panel--containers" aria-label="Containers">`
    + `<div class="dashboard-panel-head dashboard-panel-head--containers"><span class="dashboard-panel-eyebrow">Containers</span>${renderToolbar(s, lists.hiddenCount)}</div>`
    + `<div id="error" class="error"${error ? "" : " hidden"}>${esc(error ?? "")}</div>`
    + `<div id="stacks">${stacks}</div>`
    + `<div id="hidden-stacks" class="hidden-stacks"${showHiddenList ? "" : " hidden"}>${hidden}</div>`
    + `<div id="empty" class="empty"${showEmpty ? "" : " hidden"}>${empty}</div>`
    + `</section>`;
}

// ── Página ──────────────────────────────────────────────────────────────────

export function renderWrap(s: ViewState): string {
  const projects = renderProjects(s);
  const meters = renderMetersColumn(s);
  const containers = renderContainers(s);
  const header = renderHeader(s);
  if (!s.prefs.settings.verticalMeters) {
    return header + projects + meters + containers;
  }
  return header
    + `<div class="dashboard-layout"><div class="dashboard-main">${projects}${containers}</div>`
    + `<aside class="dashboard-meters-col">${meters}</aside></div>`;
}

export { checkbox };
