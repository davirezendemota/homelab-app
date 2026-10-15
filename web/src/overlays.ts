// Modais de métricas e logs, toasts e tooltip de storage — porta de dashboard-client.ts (v2).
// Operam sobre o HTML estático de overlays do template (fora da raiz que o idiomorph atualiza).
import * as I from "./icons";
import { esc } from "./ui";
import type { Meter } from "./types";

const $ = (id: string) => document.getElementById(id)!;
const REFRESH_MS = 5000;
const LOG_MAX_LINES = 5000;

function releaseBodyScroll() {
  if (($("logs-modal") as HTMLElement).hidden && ($("meter-modal") as HTMLElement).hidden) {
    document.body.style.overflow = "";
  }
}

// ── Toasts ──────────────────────────────────────────────────────────────────

export type ToastHandle = { update(msg: string, type?: string, duration?: number): void; remove(): void };

export function showToast(message: string, type = "info", duration = 4500): ToastHandle {
  const container = $("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast-visible"));
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    toast.classList.remove("toast-visible");
    toast.classList.add("toast-hiding");
    const cleanup = () => toast.remove();
    toast.addEventListener("transitionend", cleanup, { once: true });
    setTimeout(cleanup, 250);
  };
  let timer = duration > 0 ? setTimeout(remove, duration) : null;
  return {
    update(newMessage, newType = type, newDuration = duration) {
      toast.textContent = newMessage;
      toast.className = `toast toast-${newType} toast-visible`;
      if (timer) clearTimeout(timer);
      timer = newDuration > 0 ? setTimeout(remove, newDuration) : null;
    },
    remove,
  };
}

// ── Tooltip de storage ──────────────────────────────────────────────────────

function formatStorageGb(gb: number) {
  return (gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)) + " GB";
}

export function initStorageTooltip() {
  const tip = $("storage-tooltip") as HTMLElement;
  let active: HTMLElement | null = null;
  const place = (x: number, y: number) => {
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  };
  document.addEventListener("pointerover", (e) => {
    const row = (e.target as Element).closest?.("#meters .storage-row") as HTMLElement | null;
    if (!row) return;
    const used = Number(row.dataset.usedGb);
    const total = Number(row.dataset.totalGb);
    if (!Number.isFinite(used) || !Number.isFinite(total)) return;
    active = row;
    tip.textContent = `${formatStorageGb(used)} usados · ${formatStorageGb(total)} disponíveis`;
    tip.hidden = false;
    place(e.clientX, e.clientY);
  });
  document.addEventListener("pointermove", (e) => {
    if (!active || tip.hidden) return;
    if ((e.target as Element).closest?.("#meters .storage-row") !== active) return;
    place(e.clientX, e.clientY);
  });
  document.addEventListener("pointerout", (e) => {
    const row = (e.target as Element).closest?.("#meters .storage-row");
    if (!row || row !== active) return;
    const next = e.relatedTarget as Node | null;
    if (next && row.contains(next)) return;
    active = null;
    tip.hidden = true;
  });
}

// ── Modal de detalhes de métrica ────────────────────────────────────────────

type DetailRow = { name: string; sub?: string; value: number; display: string; writable?: string; image?: string; volumes?: string };
type DetailData = {
  kind: string;
  error?: string;
  total?: number;
  rows?: DetailRow[];
  sections?: { title: string; rows?: DetailRow[] }[];
  summary?: { sub?: string; display?: string };
};

function meterBarColor(kind: string, value: number) {
  const pct = kind === "cpu" || kind === "temp" ? value : Math.min(100, value);
  if (pct >= 85) return "#f85149";
  if (pct >= 65) return "#e3b341";
  return "#3fb950";
}

function renderDetailRow(row: DetailRow, total: number, kind: string) {
  const pct = total > 0 ? Math.min(100, Math.round((row.value / total) * 100)) : 0;
  const color = meterBarColor(kind, kind === "cpu" || kind === "temp" ? row.value : pct);
  const meta = row.writable
    ? `<div class="meter-detail-meta">RW ${esc(row.writable)} · imagem ${esc(row.image)} · volumes ${esc(row.volumes)}</div>`
    : "";
  return `<div class="meter-detail-row"><div class="meter-detail-info"><div class="meter-detail-name" title="${esc(row.name)}">${esc(row.name)}</div>`
    + (row.sub ? `<div class="meter-detail-sub">${esc(row.sub)}</div>` : "")
    + `${meta}</div><div class="meter-detail-bar"><span style="width:${pct}%;background:${esc(color)}"></span></div><div class="meter-detail-value">${esc(row.display)}</div></div>`;
}

function renderMeterDetail(data: DetailData) {
  if (data.error) return `<div class="meter-detail-error">${esc(data.error)}</div>`;
  const total = data.total || 1;
  const summary = data.summary
    ? `<div class="meter-detail-summary"><div class="meter-detail-summary-sub">${esc(data.summary.sub || "")}</div><div class="meter-detail-summary-pct">${esc(data.summary.display || "")}</div></div>`
    : "";
  if (data.sections) {
    return summary + data.sections.map((section) => {
      const rows = section.rows || [];
      return `<div class="meter-detail-section"><div class="meter-detail-section-title">${esc(section.title)}</div>`
        + (rows.length ? rows.map((r) => renderDetailRow(r, total, data.kind)).join("") : `<div class="meter-detail-empty">Nenhum item</div>`)
        + `</div>`;
    }).join("");
  }
  const rows = data.rows || [];
  if (!rows.length) return summary + `<div class="meter-detail-empty">Nenhum dado disponível</div>`;
  return summary + `<div class="meter-detail-section">${rows.map((r) => renderDetailRow(r, total, data.kind)).join("")}</div>`;
}

let detailKind: string | null = null;
let detailAbort: AbortController | null = null;
let detailTimer: ReturnType<typeof setInterval> | null = null;
let getMeters: () => Meter[] = () => [];

async function loadMeterDetail(kind: string, initial = false) {
  const modal = $("meter-modal") as HTMLElement;
  const body = $("meter-modal-body");
  if (modal.hidden || detailKind !== kind) return;
  detailAbort?.abort();
  const ctrl = new AbortController();
  detailAbort = ctrl;
  try {
    const res = await fetch("/api/meters/" + encodeURIComponent(kind), { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = (await res.json()) as DetailData;
    if (ctrl.signal.aborted || modal.hidden || detailKind !== kind) return;
    body.innerHTML = renderMeterDetail(data);
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return;
    if (initial) body.innerHTML = `<div class="meter-detail-error">Falha ao carregar: ${esc((e as Error)?.message ?? e)}</div>`;
  } finally {
    if (detailAbort === ctrl) detailAbort = null;
  }
}

function stopDetailRefresh() {
  if (detailTimer) clearInterval(detailTimer);
  detailTimer = null;
}

export async function openMeterDetail(kind: string, label: string) {
  detailAbort?.abort();
  detailAbort = null;
  stopDetailRefresh();
  detailKind = kind;
  $("meter-modal-title").textContent = label;
  $("meter-modal-body").innerHTML = `<div class="meter-detail-loading">Carregando…</div>`;
  ($("meter-modal") as HTMLElement).hidden = false;
  document.body.style.overflow = "hidden";
  await loadMeterDetail(kind, true);
  if (detailKind === kind && kind === "cpu") {
    detailTimer = setInterval(() => {
      if (!document.hidden && detailKind === kind) void loadMeterDetail(kind);
    }, REFRESH_MS);
  }
}

export function closeMeterDetail() {
  detailKind = null;
  stopDetailRefresh();
  detailAbort?.abort();
  detailAbort = null;
  ($("meter-modal") as HTMLElement).hidden = true;
  releaseBodyScroll();
}

function navigateMeterDetail(delta: number) {
  if (!detailKind) return;
  const nav = getMeters().filter((m) => m.detailKey).map((m) => ({ kind: m.detailKey!, label: m.label }));
  const idx = nav.findIndex((n) => n.kind === detailKind);
  if (idx < 0) return;
  const next = nav[(idx + delta + nav.length) % nav.length]!;
  void openMeterDetail(next.kind, next.label);
}

// ── Modal de logs ───────────────────────────────────────────────────────────

const STACK_LOG_PALETTE = ["#79c0ff", "#d2a8ff", "#7ee787", "#ffa657", "#ff7b72", "#e3b341", "#f778ba", "#56d4dd"];
const STACK_LOG_LINE_RE = /^(\[([^\]]+)\])\s?(.*)$/;
const stackColorCache = new Map<string, string>();

function stackLogColor(name: string) {
  let color = stackColorCache.get(name);
  if (!color) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    color = STACK_LOG_PALETTE[Math.abs(h) % STACK_LOG_PALETTE.length]!;
    stackColorCache.set(name, color);
  }
  return color;
}

let logsAbort: AbortController | null = null;
let logsStickBottom = true;
let logsStackColors = false;
let logsPending = "";
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

function setLogsLive(live: boolean) {
  $("logs-live").classList.toggle("is-idle", !live);
  $("logs-live-text").textContent = live ? "Ao vivo" : "Parado";
}

function resetCopyBtn() {
  const btn = $("logs-copy");
  if (copyResetTimer) clearTimeout(copyResetTimer);
  copyResetTimer = null;
  btn.classList.remove("is-copied");
  btn.innerHTML = I.COPY;
  btn.title = "Copiar logs";
  btn.setAttribute("aria-label", "Copiar logs");
}

function resetProgress() {
  ($("logs-progress") as HTMLElement).hidden = true;
  ($("logs-progress-bar") as HTMLElement).style.width = "0%";
}

export function closeLogs() {
  logsAbort?.abort();
  logsAbort = null;
  setLogsLive(false);
  resetCopyBtn();
  resetProgress();
  ($("logs-modal") as HTMLElement).hidden = true;
  releaseBodyScroll();
}

function trimLogLines(view: HTMLElement) {
  if (logsStackColors) {
    while (view.childElementCount > LOG_MAX_LINES) view.firstElementChild!.remove();
    return;
  }
  const text = view.textContent ?? "";
  let count = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text.charCodeAt(i) === 10 && ++count > LOG_MAX_LINES) {
      view.textContent = text.slice(i + 1);
      return;
    }
  }
}

function appendStackLine(view: HTMLElement, line: string) {
  const span = document.createElement("span");
  span.className = "log-stack-line";
  const m = STACK_LOG_LINE_RE.exec(line);
  if (m) {
    span.style.color = stackLogColor(m[2]!);
    span.textContent = m[1] + (m[3] ? " " + m[3] : "");
  } else {
    span.textContent = line;
  }
  view.appendChild(span);
}

function updateScrollProgress() {
  const el = $("logs-scroll");
  const bar = $("logs-progress") as HTMLElement;
  const fill = $("logs-progress-bar") as HTMLElement;
  const max = el.scrollHeight - el.clientHeight;
  const atBottom = max <= 0 || el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
  logsStickBottom = atBottom;
  if (atBottom) {
    bar.hidden = true;
    fill.style.width = "0%";
    return;
  }
  bar.hidden = false;
  fill.style.width = Math.max(0, Math.min(100, (el.scrollTop / max) * 100)).toFixed(2) + "%";
}

function appendLogs(text: string) {
  const view = $("logs-view");
  const scroller = $("logs-scroll");
  if (logsStackColors) {
    logsPending += text;
    const parts = logsPending.split("\n");
    logsPending = parts.pop() ?? "";
    for (const line of parts) appendStackLine(view, line);
  } else {
    view.appendChild(document.createTextNode(text));
    if (view.childNodes.length > 64) view.normalize();
  }
  trimLogLines(view);
  if (logsStickBottom) scroller.scrollTop = scroller.scrollHeight;
  updateScrollProgress();
}

function flushPending() {
  if (!logsPending) return;
  appendStackLine($("logs-view"), logsPending);
  logsPending = "";
}

async function streamLogs(url: string, title: string, stackColors: boolean) {
  closeLogs();
  $("logs-modal-title").textContent = title;
  logsStackColors = stackColors;
  logsPending = "";
  $("logs-view").textContent = "";
  logsStickBottom = true;
  resetProgress();
  ($("logs-modal") as HTMLElement).hidden = false;
  document.body.style.overflow = "hidden";
  setLogsLive(true);
  const ctrl = new AbortController();
  logsAbort = ctrl;
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error((await res.text()) || "HTTP " + res.status);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      appendLogs(decoder.decode(value, { stream: true }));
    }
    appendLogs(decoder.decode());
    if (logsStackColors) flushPending();
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return;
    appendLogs("\n[erro] " + ((e as Error)?.message ?? e) + "\n");
    if (logsStackColors) flushPending();
  } finally {
    if (logsAbort === ctrl) {
      logsAbort = null;
      setLogsLive(false);
    }
  }
}

export function openLogs(id: string, name: string) {
  void streamLogs("/api/logs/" + encodeURIComponent(id), name, false);
}

export function openStackLogs(stack: string) {
  void streamLogs("/api/logs/stack/" + encodeURIComponent(stack), "Stack " + stack, true);
}

async function copyLogs() {
  const text = $("logs-view").textContent || "";
  if (!text) return;
  const btn = $("logs-copy");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  btn.classList.add("is-copied");
  btn.innerHTML = I.CHECK_STROKE;
  btn.title = "Copiado";
  btn.setAttribute("aria-label", "Logs copiados");
  if (copyResetTimer) clearTimeout(copyResetTimer);
  copyResetTimer = setTimeout(resetCopyBtn, 1600);
}

function clearLogs() {
  const view = $("logs-view");
  if (!view.textContent && !view.childElementCount) return;
  view.textContent = "";
  logsPending = "";
  logsStickBottom = true;
  resetProgress();
  $("logs-scroll").scrollTop = 0;
}

// ── Wiring ──────────────────────────────────────────────────────────────────

export function initOverlays(meters: () => Meter[]) {
  getMeters = meters;
  initStorageTooltip();
  $("meter-close").addEventListener("click", closeMeterDetail);
  $("meter-prev").addEventListener("click", () => navigateMeterDetail(-1));
  $("meter-next").addEventListener("click", () => navigateMeterDetail(1));
  $("meter-modal").addEventListener("click", (e) => {
    if ((e.target as Element).id === "meter-modal") closeMeterDetail();
  });
  $("logs-close").addEventListener("click", closeLogs);
  $("logs-copy").addEventListener("click", () => void copyLogs());
  $("logs-clear").addEventListener("click", clearLogs);
  $("logs-modal").addEventListener("click", (e) => {
    if ((e.target as Element).id === "logs-modal") closeLogs();
  });
  $("logs-scroll").addEventListener("scroll", updateScrollProgress);
}

/** Fecha o overlay do topo; retorna true se algo foi fechado (para o Esc). */
export function closeTopOverlay(): boolean {
  if (!($("meter-modal") as HTMLElement).hidden) {
    closeMeterDetail();
    return true;
  }
  if (!($("logs-modal") as HTMLElement).hidden) {
    closeLogs();
    return true;
  }
  return false;
}

export function onVisible() {
  if (detailKind === "cpu" && !($("meter-modal") as HTMLElement).hidden) void loadMeterDetail("cpu");
}
