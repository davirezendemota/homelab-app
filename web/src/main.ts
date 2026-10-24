import { Idiomorph } from "idiomorph";
import { closeMenu, openMenu, openMenuId, setMenuHtml } from "./menu";
import {
  closeTopOverlay,
  initOverlays,
  onVisible,
  openLogs,
  openMeterDetail,
  openStackLogs,
  showToast,
} from "./overlays";
import { closeEditor, isEditorOpen, openEditor } from "./project-editor";
import { renderSettingsMenu, renderWrap, type ChartPoint, type ViewState } from "./render";
import { MENU_ITEM } from "./ui";
import {
  CONTAINER_COLUMNS,
  containerTableInlineStyle,
  normalizeColumnWidths,
  type ColumnWidths,
} from "./container-columns";
import type { BootPayload, PagePayload, Prefs, Project, Settings } from "./types";
import type { DashboardViewState } from "./view-model";

const CHART_HISTORY_MAX = 60;

const bootEl = document.getElementById("boot");
if (!bootEl?.textContent) throw new Error("boot payload missing");
const boot = JSON.parse(bootEl.textContent) as BootPayload;

const view: DashboardViewState = { query: "", sortKey: null, sortDir: 1, showHidden: false };

function normalizePrefs(p: Partial<Prefs> | null | undefined): Prefs {
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  return {
    favorites: list(p?.favorites),
    hiddenContainers: list(p?.hiddenContainers),
    hiddenStacks: list(p?.hiddenStacks),
    collapsedStacks: list(p?.collapsedStacks),
    settings: {
      compactView: Boolean(p?.settings?.compactView),
      truncateNames: Boolean(p?.settings?.truncateNames),
      verticalMeters: Boolean(p?.settings?.verticalMeters),
      containerColumnWidths: normalizeColumnWidths(p?.settings?.containerColumnWidths),
    },
  };
}

const state: ViewState = {
  data: boot.data,
  prefs: { ...normalizePrefs(boot.prefs), view },
  projects: boot.projects ?? [],
  projectsError: null,
  error: null,
  clock: nowClock(),
  fullscreen: Boolean(document.fullscreenElement),
  fullscreenEnabled: Boolean(document.fullscreenEnabled),
  openMenu: null,
  drag: { id: null, over: null },
  charts: {},
};

const wrap = document.querySelector<HTMLElement>(".wrap")!;

function nowClock() {
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Render ──────────────────────────────────────────────────────────────────

let frame = 0;
function render() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    Idiomorph.morph(wrap, renderWrap(state), { morphStyle: "innerHTML" });
    if (openMenuId() === "settings") setMenuHtml("settings", renderSettingsMenu(state));
  });
}

function applyBodyClasses() {
  const s = state.prefs.settings;
  document.body.classList.toggle("compact-view", s.compactView);
  document.body.classList.toggle("truncate-names", s.truncateNames);
  document.body.classList.toggle("meters-vertical", s.verticalMeters);
}

function recordChartSamples() {
  const t = Date.now();
  for (const m of state.data.meters) {
    if (!m.chartKey) continue;
    const bucket: ChartPoint[] = (state.charts[m.chartKey] ??= []);
    bucket.push({ t, v: Number(m.pct ?? 0) });
    if (bucket.length > CHART_HISTORY_MAX) bucket.shift();
  }
}

function applyStatus(next: PagePayload) {
  state.data = next;
  state.clock = nowClock();
  recordChartSamples();
  render();
}

// ── Prefs ───────────────────────────────────────────────────────────────────

async function savePrefs(partial: Partial<Prefs>) {
  try {
    const res = await fetch("/api/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
  } catch (e) {
    state.error = "Falha ao salvar preferências: " + ((e as Error)?.message ?? e);
    render();
  }
}

function setPrefs(patch: Partial<Prefs>) {
  Object.assign(state.prefs, patch);
  void savePrefs(patch);
  render();
}

function setSetting(key: keyof Settings, value: boolean) {
  state.prefs.settings = { ...state.prefs.settings, [key]: value };
  applyBodyClasses();
  void savePrefs({ settings: state.prefs.settings });
  render();
}

function applyColumnWidthsToDom(widths: ColumnWidths) {
  const style = containerTableInlineStyle(widths);
  wrap.querySelectorAll<HTMLElement>(".container-table").forEach((table) => {
    table.setAttribute("style", style);
  });
}

let columnResize: { index: number; startX: number; startW: number; handle: HTMLElement } | null = null;

function onColumnResizePointerDown(e: PointerEvent) {
  const handle = (e.target as Element).closest<HTMLElement>("[data-col-resize]");
  if (!handle) return;
  e.preventDefault();
  const index = Number(handle.dataset.colResize);
  if (!Number.isFinite(index)) return;
  const widths = normalizeColumnWidths(state.prefs.settings.containerColumnWidths);
  columnResize = { index, startX: e.clientX, startW: widths[index], handle };
  handle.classList.add("is-dragging");
  document.body.classList.add("is-col-resizing");
  handle.setPointerCapture(e.pointerId);
}

function onColumnResizePointerMove(e: PointerEvent) {
  if (!columnResize) return;
  const delta = e.clientX - columnResize.startX;
  const min = CONTAINER_COLUMNS[columnResize.index].min;
  const widths = normalizeColumnWidths(state.prefs.settings.containerColumnWidths);
  widths[columnResize.index] = Math.max(min, Math.round(columnResize.startW + delta));
  state.prefs.settings = { ...state.prefs.settings, containerColumnWidths: widths };
  applyColumnWidthsToDom(widths);
}

function onColumnResizePointerUp(e: PointerEvent) {
  if (!columnResize) return;
  columnResize.handle.classList.remove("is-dragging");
  document.body.classList.remove("is-col-resizing");
  void savePrefs({ settings: state.prefs.settings });
  columnResize = null;
}

function saveHidden() {
  const p = state.prefs;
  if (!p.hiddenContainers.length && !p.hiddenStacks.length) view.showHidden = false;
  void savePrefs({ hiddenContainers: p.hiddenContainers, hiddenStacks: p.hiddenStacks });
  render();
}

function toggleFavorite(name: string) {
  const fav = state.prefs.favorites;
  setPrefs({ favorites: fav.includes(name) ? fav.filter((n) => n !== name) : [...fav, name] });
}

function toggleHiddenStack(stack: string) {
  const p = state.prefs;
  if (p.hiddenStacks.includes(stack)) {
    p.hiddenStacks = p.hiddenStacks.filter((s) => s !== stack);
  } else {
    p.hiddenStacks = [...p.hiddenStacks, stack];
    const inStack = new Set(state.data.containers.filter((c) => c.stack === stack).map((c) => c.name));
    p.hiddenContainers = p.hiddenContainers.filter((n) => !inStack.has(n));
    view.showHidden = true;
  }
  saveHidden();
}

function toggleHidden(name: string) {
  const p = state.prefs;
  const container = state.data.containers.find((c) => c.name === name);
  if (!container) return;
  const stack = container.stack;
  if (p.hiddenStacks.includes(stack)) {
    p.hiddenStacks = p.hiddenStacks.filter((s) => s !== stack);
    const others = state.data.containers.filter((c) => c.stack === stack && c.name !== name).map((c) => c.name);
    p.hiddenContainers = [...new Set([...p.hiddenContainers, ...others])];
    view.showHidden = true;
  } else if (p.hiddenContainers.includes(name)) {
    p.hiddenContainers = p.hiddenContainers.filter((n) => n !== name);
  } else {
    p.hiddenContainers = [...p.hiddenContainers, name];
    view.showHidden = true;
  }
  saveHidden();
}

function toggleCollapsed(key: string) {
  const cs = state.prefs.collapsedStacks;
  setPrefs({ collapsedStacks: cs.includes(key) ? cs.filter((k) => k !== key) : [...cs, key] });
}

function toggleSort(key: DashboardViewState["sortKey"]) {
  if (view.sortKey === key) {
    if (view.sortDir === 1) view.sortDir = -1;
    else {
      view.sortKey = null;
      view.sortDir = 1;
    }
  } else {
    view.sortKey = key;
    view.sortDir = 1;
  }
  render();
}

const LEGACY_KEYS = {
  favorites: "homelab-homepage-favorites",
  hiddenContainers: "homelab-homepage-hidden",
  hiddenStacks: "homelab-homepage-hidden-stacks",
  collapsedStacks: "homelab-homepage-collapsed-stacks",
  settings: "homelab-homepage-settings",
};

function migrateLegacyPrefs() {
  try {
    if (!Object.values(LEGACY_KEYS).some((k) => localStorage.getItem(k) !== null)) return;
    const list = (k: string) => {
      try {
        const v = JSON.parse(localStorage.getItem(k) ?? "[]");
        return Array.isArray(v) ? v.map(String) : [];
      } catch {
        return [];
      }
    };
    let s: Record<string, unknown> = {};
    try {
      s = JSON.parse(localStorage.getItem(LEGACY_KEYS.settings) ?? "{}");
    } catch {
      /* ignore */
    }
    const legacy: Prefs = {
      favorites: list(LEGACY_KEYS.favorites),
      hiddenContainers: list(LEGACY_KEYS.hiddenContainers),
      hiddenStacks: list(LEGACY_KEYS.hiddenStacks),
      collapsedStacks: list(LEGACY_KEYS.collapsedStacks),
      settings: { compactView: Boolean(s.compactView), truncateNames: Boolean(s.truncateNames), verticalMeters: Boolean(s.verticalMeters) },
    };
    const any = (p: Prefs) =>
      p.favorites.length || p.hiddenContainers.length || p.hiddenStacks.length || p.collapsedStacks.length
      || p.settings.compactView || p.settings.truncateNames || p.settings.verticalMeters;
    if (!any(state.prefs) && any(legacy)) {
      Object.assign(state.prefs, legacy);
      applyBodyClasses();
      void savePrefs(legacy);
    }
    Object.values(LEGACY_KEYS).forEach((k) => localStorage.removeItem(k));
  } catch {
    /* localStorage indisponível */
  }
}

// ── Ações ───────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, { verb: string; done: string; stackDone: string }> = {
  start: { verb: "Iniciando", done: "iniciado", stackDone: "iniciada" },
  stop: { verb: "Parando", done: "parado", stackDone: "parada" },
  restart: { verb: "Reiniciando", done: "reiniciado", stackDone: "reiniciada" },
  delete: { verb: "Apagando", done: "apagado", stackDone: "apagada" },
};

function formatActionError(err: unknown) {
  const msg = (err as Error)?.message ?? String(err);
  if (msg === "Failed to fetch" || msg === "NetworkError when attempting to fetch resource.") {
    return "Conexão perdida com o servidor (operação demorou demais ou o serviço reiniciou).";
  }
  return msg;
}

async function refreshStatus() {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    if (res.ok) applyStatus((await res.json()) as PagePayload);
  } catch {
    /* o SSE traz o próximo estado */
  }
}

async function runAction(isStack: boolean, target: string, label: string, action: string) {
  if (action === "delete") {
    const msg = isStack
      ? `Apagar todos os containers da stack "${label}"? Esta ação não pode ser desfeita.`
      : `Apagar o container "${label}"? Esta ação não pode ser desfeita.`;
    if (!confirm(msg)) return;
  }
  const labels = ACTION_LABELS[action];
  const kind = isStack ? "stack" : "container";
  const toast = showToast(labels ? `${labels.verb} ${kind} "${label}"…` : `Executando ${action}…`, "info", 0);
  const base = isStack ? "/api/stacks/" : "/api/containers/";
  const url = base + encodeURIComponent(target) + (action === "delete" ? "" : "/" + action);
  try {
    const res = await fetch(url, { method: action === "delete" ? "DELETE" : "POST", cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
    const done = labels ? (isStack ? labels.stackDone : labels.done) : "";
    toast.update(labels ? `${isStack ? "Stack" : "Container"} "${label}" ${done}.` : "Ação concluída.", "success");
    await refreshStatus();
  } catch (err) {
    toast.remove();
    showToast((isStack ? "Falha na stack: " : "Falha ao executar ação: ") + formatActionError(err), "error", 6000);
  }
}

// ── Projetos ────────────────────────────────────────────────────────────────

async function reloadProjects() {
  try {
    const res = await fetch("/api/projects", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    state.projects = ((await res.json()) as { projects: Project[] }).projects ?? [];
    state.projectsError = null;
  } catch (e) {
    state.projectsError = (e as Error)?.message ?? String(e);
  }
  render();
}

function openProjectEditor(project: Project | null) {
  closeMenu();
  openEditor({
    project,
    allContainerNames: state.data.containers.map((c) => c.name),
    onSaved: (saved) => {
      const idx = state.projects.findIndex((p) => p.id === saved.id);
      state.projects = idx === -1 ? [...state.projects, saved] : state.projects.map((p) => (p.id === saved.id ? saved : p));
      render();
    },
  });
}

async function deleteProject(project: Project) {
  if (!confirm(`Apagar o projeto "${project.name}"?`)) return;
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    state.projects = state.projects.filter((p) => p.id !== project.id);
  } catch (e) {
    state.projectsError = (e as Error)?.message ?? String(e);
  }
  render();
}

async function persistProjectOrder(ordered: Project[]) {
  try {
    const res = await fetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: ordered.map((p) => p.id) }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "HTTP " + res.status);
    }
    state.projectsError = null;
  } catch (e) {
    state.projectsError = (e as Error)?.message ?? String(e);
    void reloadProjects();
  }
  render();
}

function dropProject(targetId: string) {
  const draggedId = state.drag.id;
  state.drag = { id: null, over: null };
  if (!draggedId || draggedId === targetId) return render();
  const from = state.projects.findIndex((p) => p.id === draggedId);
  const to = state.projects.findIndex((p) => p.id === targetId);
  if (from === -1 || to === -1) return render();
  const next = [...state.projects];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  state.projects = next;
  void persistProjectOrder(next);
  render();
}

// ── Menus ───────────────────────────────────────────────────────────────────

function toggleMenu(id: string, trigger: HTMLElement) {
  if (openMenuId() === id) {
    closeMenu();
    return;
  }
  const onClose = () => {
    state.openMenu = null;
    render();
  };
  if (id === "settings") {
    openMenu({ id, trigger, html: renderSettingsMenu(state), className: "header-prefs-dropdown", sideOffset: 6, onClose });
  } else {
    const pid = id.slice("project:".length);
    const content = openMenu({
      id,
      trigger,
      html: `<div role="menuitem" tabindex="-1" data-slot="dropdown-menu-item" data-variant="default" data-menu-action="edit" class="${MENU_ITEM}">Editar</div>`
        + `<div role="menuitem" tabindex="-1" data-slot="dropdown-menu-item" data-variant="destructive" data-menu-action="delete" class="${MENU_ITEM}">Excluir</div>`,
      onClose,
    });
    content.addEventListener("click", (e) => {
      const item = (e.target as Element).closest<HTMLElement>("[data-menu-action]");
      const project = state.projects.find((p) => p.id === pid);
      if (!item || !project) return;
      closeMenu();
      if (item.dataset.menuAction === "edit") openProjectEditor(project);
      else void deleteProject(project);
    });
  }
  state.openMenu = id;
  render();
}

document.addEventListener("click", (e) => {
  const pref = (e.target as Element).closest<HTMLElement>(".header-prefs-dropdown [data-pref]");
  if (!pref) return;
  e.preventDefault();
  const key = pref.dataset.pref as keyof Settings;
  setSetting(key, !state.prefs.settings[key]);
});

// ── Eventos da página ───────────────────────────────────────────────────────

function onWrapClick(e: MouseEvent) {
  const t = e.target as Element;
  const hit = <T extends HTMLElement = HTMLElement>(sel: string) => t.closest<T>(sel);

  const menuTrigger = hit("[data-menu]");
  if (menuTrigger) return toggleMenu(menuTrigger.dataset.menu!, menuTrigger);
  if (hit("#fullscreen-toggle")) {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
    return;
  }
  if (hit("#meters-layout-toggle")) return setSetting("verticalMeters", !state.prefs.settings.verticalMeters);
  const sort = hit("[data-sort]");
  if (sort) return toggleSort(sort.dataset.sort as DashboardViewState["sortKey"]);
  if (hit("#hidden-show-toggle")) {
    view.showHidden = !view.showHidden;
    return render();
  }
  const meter = hit("#meters [data-meter-detail]");
  if (meter) return void openMeterDetail(meter.dataset.meterDetail!, meter.dataset.meterLabel || meter.dataset.meterDetail!);
  if (hit("[data-project-new]")) return openProjectEditor(null);

  if (!t.closest("#stacks, #hidden-stacks")) return;
  const stackLogs = hit("[data-stack-logs]");
  if (stackLogs) return openStackLogs(stackLogs.dataset.stackLogs!);
  const stackAction = hit("[data-stack-action]");
  if (stackAction) return void runAction(true, stackAction.dataset.stackName!, stackAction.dataset.stackName!, stackAction.dataset.stackAction!);
  const action = hit("[data-action]");
  if (action) return void runAction(false, action.dataset.id!, action.dataset.name!, action.dataset.action!);
  const fav = hit("[data-fav]");
  if (fav) return toggleFavorite(fav.dataset.fav!);
  const collapse = hit("[data-collapse-stack]");
  if (collapse) return toggleCollapsed(collapse.dataset.collapseStack!);
  const hideStack = hit("[data-hide-stack]");
  if (hideStack) return toggleHiddenStack(hideStack.dataset.hideStack!);
  const hide = hit("[data-hide]");
  if (hide) return toggleHidden(hide.dataset.hide!);
  const logs = hit("[data-logs]");
  if (logs) return openLogs(logs.dataset.logs!, logs.dataset.name!);
}

wrap.addEventListener("click", onWrapClick);
wrap.addEventListener("pointerdown", onColumnResizePointerDown);
wrap.addEventListener("pointermove", onColumnResizePointerMove);
wrap.addEventListener("pointerup", onColumnResizePointerUp);
wrap.addEventListener("pointercancel", onColumnResizePointerUp);

wrap.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id !== "q") return;
  view.query = input.value;
  render();
});

// Drag & drop dos cards de projeto (HTML5 DnD, como na v2).
function cardOf(e: Event) {
  return (e.target as Element).closest?.<HTMLElement>("[data-project-id]") ?? null;
}
wrap.addEventListener("dragstart", (e) => {
  const card = cardOf(e);
  if (!card) return;
  if ((e.target as Element).closest("a, button, [role='menu']")) {
    e.preventDefault();
    return;
  }
  e.dataTransfer!.effectAllowed = "move";
  e.dataTransfer!.setData("text/plain", card.dataset.projectId!);
  state.drag = { id: card.dataset.projectId!, over: null };
  render();
});
wrap.addEventListener("dragover", (e) => {
  const card = cardOf(e);
  if (!card || !state.drag.id) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = "move";
  if (state.drag.over !== card.dataset.projectId) {
    state.drag.over = card.dataset.projectId!;
    render();
  }
});
wrap.addEventListener("dragleave", (e) => {
  const card = cardOf(e);
  if (!card || card.contains(e.relatedTarget as Node)) return;
  if (state.drag.over === card.dataset.projectId) {
    state.drag.over = null;
    render();
  }
});
wrap.addEventListener("drop", (e) => {
  const card = cardOf(e);
  if (!card) return;
  e.preventDefault();
  dropProject(card.dataset.projectId!);
});
wrap.addEventListener("dragend", () => {
  if (!state.drag.id) return;
  state.drag = { id: null, over: null };
  render();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (closeMenu()) return;
  if (isEditorOpen()) return closeEditor();
  closeTopOverlay();
});

document.addEventListener("fullscreenchange", () => {
  state.fullscreen = Boolean(document.fullscreenElement);
  render();
});

// ── Tempo real (SSE) ────────────────────────────────────────────────────────

let es: EventSource | null = null;

function connect() {
  es?.close();
  es = new EventSource("/api/stream");
  es.addEventListener("status", (ev) => {
    if (state.error) state.error = null;
    applyStatus(JSON.parse((ev as MessageEvent).data) as PagePayload);
  });
  es.addEventListener("history", (ev) => {
    state.data = { ...state.data, containerHistory: JSON.parse((ev as MessageEvent).data) };
    render();
  });
  es.onerror = () => {
    if (es?.readyState === EventSource.CLOSED) setTimeout(connect, 3000);
    state.error = "Conexão com o servidor perdida — reconectando…";
    render();
  };
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    es?.close();
    es = null;
  } else {
    connect();
    onVisible();
  }
});

// ── Boot ────────────────────────────────────────────────────────────────────

initOverlays(() => state.data.meters);
applyBodyClasses();
migrateLegacyPrefs();
recordChartSamples();
Idiomorph.morph(wrap, renderWrap(state), { morphStyle: "innerHTML" });
connect();

