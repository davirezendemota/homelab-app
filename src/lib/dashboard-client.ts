// @ts-nocheck

import { SHADCN } from "./shadcn-theme";
let dashboardControllerCleanup = null;
let dashboardViewActions = null;
let dashboardMeterActions = null;
let dashboardInteractionActions = null;
let dashboardLifecycleActions = null;
let dashboardLogsActions = null;

export function setDashboardQuery(query) {
  dashboardViewActions?.setQuery(query);
}

export function toggleDashboardSort(key) {
  dashboardViewActions?.toggleSort(key);
}

export function toggleDashboardShowHidden() {
  dashboardViewActions?.toggleShowHidden();
}

let setVerticalMetersFn = null;
let setCompactViewFn = null;
let setTruncateNamesFn = null;

export function setDashboardVerticalMeters(enabled) {
  setVerticalMetersFn?.(enabled);
}

export function setDashboardCompactView(enabled) {
  setCompactViewFn?.(enabled);
}

export function setDashboardTruncateNames(enabled) {
  setTruncateNamesFn?.(enabled);
}

export function toggleDashboardMetersLayout() {
  if (!setVerticalMetersFn) return;
  const next = !document.body.classList.contains("meters-vertical");
  setVerticalMetersFn(next);
}

export function openDashboardMeterDetail(kind, label) {
  dashboardMeterActions?.openDetail(kind, label);
}

export function toggleDashboardHiddenStack(stackName) {
  dashboardInteractionActions?.toggleHiddenStack(stackName);
}

export function toggleDashboardHiddenContainer(name) {
  dashboardInteractionActions?.toggleHidden(name);
}

export function toggleDashboardFavorite(name) {
  dashboardInteractionActions?.toggleFavorite(name);
}

export function toggleDashboardStackCollapsed(stackId) {
  dashboardInteractionActions?.toggleStackCollapsed(stackId);
}

export function runDashboardContainerAction(id, name, action) {
  dashboardLifecycleActions?.container(id, name, action);
}

export function runDashboardStackAction(stackName, action) {
  dashboardLifecycleActions?.stack(stackName, action);
}

export function openDashboardLogs(id, name) {
  dashboardLogsActions?.open(id, name);
}

export function openDashboardStackLogs(stackName) {
  dashboardLogsActions?.openStack(stackName);
}

/** @param {import('./dashboard-bridge').DashboardBridge | undefined} bridge */
export function initDashboard(DATA, bridge) {
    if (dashboardControllerCleanup) {
      dashboardControllerCleanup();
      dashboardControllerCleanup = null;
    }

    const reactMode = Boolean(bridge?.onDataUpdate);
    const reactPolling = Boolean(bridge?.reactPolling);
    let APP_BUILD = DATA.loaded_build;

    const state = { query: "", sortKey: null, sortDir: 1, showHidden: false };
    const REFRESH_MS = 5000;
    let refreshing = false;

    const LOGS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h8M8 10h8M8 14h5"/><rect x="4" y="3" width="16" height="18" rx="2"/></svg>`;
    const STAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3.5 2.7 5.5 6 .9-4.4 4.2 1 5.9L12 17.2 6.7 20l1-5.9L3.4 9.9l6-.9z"/></svg>`;
    const HIDE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    const CHEVRON_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
    const CHEVRON_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>`;
    const EXPAND_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="M9 21H3v-6"/><path d="m3 21 7-7"/></svg>`;
    const PLAY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>`;
    const STOP_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>`;
    const RESTART_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`;
    const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

    const ACTION_LABELS = {
      start: { verb: "Iniciando", done: "iniciado", stackDone: "iniciada" },
      stop: { verb: "Parando", done: "parado", stackDone: "parada" },
      restart: { verb: "Reiniciando", done: "reiniciado", stackDone: "reiniciada" },
      delete: { verb: "Apagando", done: "apagado", stackDone: "apagada" },
    };

    let favorites = new Set();
    let hiddenContainers = new Set();
    let hiddenStacks = new Set();
    let collapsedStacks = new Set();
    let settings = {
      compactView: false,
      truncateNames: false,
      verticalMeters: false,
    };
    let logsAbort = null;
    let logsStickBottom = true;
    let logsStackColors = false;
    let logsStackLinePending = "";
    let copyResetTimer = null;

    const STACK_LOG_PALETTE = [
      "#79c0ff",
      "#d2a8ff",
      "#7ee787",
      "#ffa657",
      "#ff7b72",
      "#e3b341",
      "#f778ba",
      "#56d4dd",
    ];
    const stackLogColorCache = new Map();

    function stackLogColor(containerName) {
      let color = stackLogColorCache.get(containerName);
      if (!color) {
        let h = 0;
        for (let i = 0; i < containerName.length; i++) {
          h = (h * 31 + containerName.charCodeAt(i)) | 0;
        }
        color = STACK_LOG_PALETTE[Math.abs(h) % STACK_LOG_PALETTE.length];
        stackLogColorCache.set(containerName, color);
      }
      return color;
    }

    const STACK_LOG_LINE_RE = /^(\[([^\]]+)\])\s?(.*)$/;

    function appendStackLogLine(view, line) {
      const span = document.createElement("span");
      span.className = "log-stack-line";
      const match = STACK_LOG_LINE_RE.exec(line);
      if (match) {
        span.style.color = stackLogColor(match[2]);
        span.textContent = match[1] + (match[3] ? " " + match[3] : "");
      } else {
        span.textContent = line;
      }
      view.appendChild(span);
    }

    function appendStackLogsChunk(view, text) {
      logsStackLinePending += text;
      const parts = logsStackLinePending.split("\n");
      logsStackLinePending = parts.pop() ?? "";
      for (const line of parts) {
        appendStackLogLine(view, line);
      }
    }

    function flushStackLogLinePending() {
      if (!logsStackLinePending) return;
      const view = document.getElementById("logs-view");
      appendStackLogLine(view, logsStackLinePending);
      logsStackLinePending = "";
    }

    const LEGACY_KEYS = {
      favorites: "homelab-homepage-favorites",
      hiddenContainers: "homelab-homepage-hidden",
      hiddenStacks: "homelab-homepage-hidden-stacks",
      collapsedStacks: "homelab-homepage-collapsed-stacks",
      settings: "homelab-homepage-settings",
    };

    function readLegacyList(key) {
      try {
        const raw = localStorage.getItem(key);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.map(String) : [];
      } catch {
        return [];
      }
    }

    function readLegacyPrefs() {
      let settingsData = {};
      try {
        const raw = localStorage.getItem(LEGACY_KEYS.settings);
        settingsData = raw ? JSON.parse(raw) : {};
      } catch {
        settingsData = {};
      }
      return {
        favorites: readLegacyList(LEGACY_KEYS.favorites),
        hiddenContainers: readLegacyList(LEGACY_KEYS.hiddenContainers),
        hiddenStacks: readLegacyList(LEGACY_KEYS.hiddenStacks),
        collapsedStacks: readLegacyList(LEGACY_KEYS.collapsedStacks),
        settings: {
          compactView: Boolean(settingsData.compactView),
          truncateNames: Boolean(settingsData.truncateNames),
          verticalMeters: Boolean(settingsData.verticalMeters),
        },
      };
    }

    function hasLegacyPrefs() {
      return Object.values(LEGACY_KEYS).some((key) => localStorage.getItem(key) !== null);
    }

    function clearLegacyPrefs() {
      Object.values(LEGACY_KEYS).forEach((key) => localStorage.removeItem(key));
    }

    function hasAnyPrefs(prefs) {
      return !!(
        prefs.favorites?.length ||
        prefs.hiddenContainers?.length ||
        prefs.hiddenStacks?.length ||
        prefs.collapsedStacks?.length ||
        prefs.settings?.compactView ||
        prefs.settings?.truncateNames ||
        prefs.settings?.verticalMeters
      );
    }

    function applyPrefs(prefs) {
      favorites = new Set(prefs.favorites || []);
      hiddenContainers = new Set(prefs.hiddenContainers || []);
      hiddenStacks = new Set(prefs.hiddenStacks || []);
      collapsedStacks = new Set(prefs.collapsedStacks || []);
      settings = {
        compactView: Boolean(prefs.settings?.compactView),
        truncateNames: Boolean(prefs.settings?.truncateNames),
        verticalMeters: Boolean(prefs.settings?.verticalMeters),
      };
    }

    async function loadPrefs() {
      const legacy = hasLegacyPrefs() ? readLegacyPrefs() : null;

      const res = await fetch("/api/prefs", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      let prefs = await res.json();

      if (legacy) {
        if (!hasAnyPrefs(prefs) && hasAnyPrefs(legacy)) {
          const putRes = await fetch("/api/prefs", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(legacy),
          });
          if (!putRes.ok) throw new Error("HTTP " + putRes.status);
          prefs = await putRes.json();
        }
        clearLegacyPrefs();
      }

      applyPrefs(prefs);
    }

    async function savePrefs(partial) {
      try {
        const res = await fetch("/api/prefs", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(partial),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
      } catch (e) {
        const err = document.getElementById("error");
        err.hidden = false;
        err.textContent = "Falha ao salvar preferências: " + (e && e.message ? e.message : e);
      }
    }

    function saveFavorites() {
      savePrefs({ favorites: [...favorites] });
    }

    function isFavorite(name) {
      return favorites.has(name);
    }

    function toggleFavorite(name) {
      if (favorites.has(name)) favorites.delete(name);
      else favorites.add(name);
      saveFavorites();
      render();
    }

    function saveHidden() {
      savePrefs({
        hiddenContainers: [...hiddenContainers],
        hiddenStacks: [...hiddenStacks],
      });
    }

    function isHiddenStack(stackName) {
      return hiddenStacks.has(stackName);
    }

    function isHiddenContainer(c) {
      return hiddenStacks.has(c.stack) || hiddenContainers.has(c.name);
    }

    function isHidden(name) {
      const container = DATA.containers.find((c) => c.name === name);
      return container ? isHiddenContainer(container) : hiddenContainers.has(name);
    }

    function containerNamesInStack(stackName) {
      return DATA.containers
        .filter((c) => c.stack === stackName)
        .map((c) => c.name);
    }

    function toggleHiddenStack(stackName) {
      if (!stackName) return;
      if (hiddenStacks.has(stackName)) {
        hiddenStacks.delete(stackName);
      } else {
        hiddenStacks.add(stackName);
        containerNamesInStack(stackName).forEach((name) => hiddenContainers.delete(name));
        state.showHidden = true;
      }
      saveHidden();
      if (!hiddenContainers.size && !hiddenStacks.size) state.showHidden = false;
      render();
    }

    function toggleHidden(name) {
      const container = DATA.containers.find((c) => c.name === name);
      if (!container) return;
      const stack = container.stack;

      if (hiddenStacks.has(stack)) {
        hiddenStacks.delete(stack);
        DATA.containers
          .filter((c) => c.stack === stack && c.name !== name)
          .forEach((c) => hiddenContainers.add(c.name));
        state.showHidden = true;
      } else if (hiddenContainers.has(name)) {
        hiddenContainers.delete(name);
      } else {
        hiddenContainers.add(name);
        state.showHidden = true;
      }

      saveHidden();
      if (!hiddenContainers.size && !hiddenStacks.size) state.showHidden = false;
      render();
    }

    function toggleShowHidden() {
      state.showHidden = !state.showHidden;
      render();
    }

    function saveCollapsedStacks() {
      savePrefs({ collapsedStacks: [...collapsedStacks] });
    }

    function stackKey(stack) {
      return stack.isFavorites ? "__favorites__" : stack.name;
    }

    function isStackCollapsed(stack) {
      return collapsedStacks.has(stackKey(stack));
    }

    function toggleStackCollapsed(stackId) {
      if (collapsedStacks.has(stackId)) collapsedStacks.delete(stackId);
      else collapsedStacks.add(stackId);
      saveCollapsedStacks();
      render();
    }

    function saveSettings() {
      savePrefs({ settings });
    }

    function applySettings() {
      document.body.classList.toggle("compact-view", settings.compactView);
      document.body.classList.toggle("truncate-names", settings.truncateNames);
      document.body.classList.toggle("meters-vertical", settings.verticalMeters);
    }

    function overlayModalsClosed() {
      return (
        document.getElementById("logs-modal")?.hidden !== false &&
        document.getElementById("meter-modal")?.hidden !== false
      );
    }

    function releaseBodyScrollIfNoOverlay() {
      if (overlayModalsClosed()) {
        document.body.style.overflow = "";
      }
    }

    function isFullscreen() {
      return Boolean(document.fullscreenElement);
    }

    function toggleFullscreen() {
      if (isFullscreen()) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
    }

    function updateFullscreenButton() {
      const btn = document.getElementById("fullscreen-toggle");
      if (!btn) return;
      const fullscreen = isFullscreen();
      btn.title = fullscreen ? "Sair da tela cheia" : "Tela cheia";
      btn.setAttribute("aria-label", fullscreen ? "Sair da tela cheia" : "Tela cheia");
      const enterIcon = btn.querySelector(".fullscreen-enter-icon");
      const exitIcon = btn.querySelector(".fullscreen-exit-icon");
      if (enterIcon) enterIcon.hidden = fullscreen;
      if (exitIcon) exitIcon.hidden = !fullscreen;
    }

    function setCompactView(enabled) {
      settings.compactView = enabled;
      saveSettings();
      applySettings();
      if (bridge?.onUiBump) bridge.onUiBump();
    }

    function setTruncateNames(enabled) {
      settings.truncateNames = enabled;
      saveSettings();
      applySettings();
      if (bridge?.onUiBump) bridge.onUiBump();
    }

    function setVerticalMeters(enabled) {
      settings.verticalMeters = enabled;
      saveSettings();
      applySettings();
      if (bridge?.onUiBump) bridge.onUiBump();
    }

    setVerticalMetersFn = setVerticalMeters;
    setCompactViewFn = setCompactView;
    setTruncateNamesFn = setTruncateNames;


    const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;

    function now() {
      return new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      });
    }

    function setClock() {
      document.getElementById("clock").textContent = now();
    }

    function uptimeSeconds(status) {
      const m = status.match(/up\\s+(\\d+)\\s+(second|minute|hour|day|week|month)/i);
      if (!m) return 0;
      const mult = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000 };
      return parseInt(m[1], 10) * (mult[m[2].toLowerCase()] || 1);
    }

    function dotStyle(status) {
      const s = status.toLowerCase();
      if (!s.startsWith("up")) {
        return {
          dot: SHADCN.mutedForeground, glow: SHADCN.mutedForegroundGlow,
        };
      }
      if (s.includes("second") || s.includes("minute")) {
        return {
          dot: "#d29922", glow: "rgba(210,153,34,.18)",
        };
      }
      return {
        dot: "#3fb950", glow: "rgba(63,185,80,.18)",
      };
    }

    function healthStyle(health) {
      if (health === "healthy") {
        return { color: "#56d364", bg: "rgba(63,185,80,.10)" };
      }
      if (health === "starting") {
        return { color: "#e3b341", bg: "rgba(210,153,34,.12)" };
      }
      if (health === "unhealthy") {
        return { color: "#f85149", bg: "rgba(248,81,73,.12)" };
      }
      return { color: SHADCN.mutedForeground, bg: SHADCN.mutedForegroundBg };
    }

    function usageMetricBadgeStyle(pct, running) {
      if (!running || pct == null || pct <= 0) {
        return { color: SHADCN.mutedForeground, bg: SHADCN.mutedForegroundBg };
      }
      if (pct <= 50) {
        return {
          color: SHADCN.foreground,
          bg: "color-mix(in oklch, var(--foreground) 10%, transparent)",
        };
      }
      if (pct <= 85) {
        return { color: "#e3b341", bg: "rgba(210,153,34,.12)" };
      }
      return { color: "#f85149", bg: "rgba(248,81,73,.12)" };
    }

    function formatPct(value) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return "0%";
      for (const decimals of [1, 2, 3, 4]) {
        const factor = 10 ** decimals;
        if (Math.round(n * factor) / factor > 0) {
          return n.toFixed(decimals) + "%";
        }
      }
      return n.toFixed(4) + "%";
    }

    function renderContainerUsage(c) {
      const running = isContainerRunning(c.status);
      const ramPct = running ? (c.memPct ?? 0) : null;
      const cpuPct = running ? (c.cpuPct ?? 0) : null;
      const ramLabel = running && ramPct != null ? formatPct(ramPct) : "—";
      const cpuLabel = running && cpuPct != null ? formatPct(cpuPct) : "—";
      const ramBadge = usageMetricBadgeStyle(ramPct, running);
      const cpuBadge = usageMetricBadgeStyle(cpuPct, running);
      const title = running
        ? `RAM ${ramLabel} · CPU ${cpuLabel}`
        : "Container parado";
      return `
        <div class="container-usage" title="${esc(title)}">
          <span class="usage-badge" style="color:${esc(ramBadge.color)};background:${esc(ramBadge.bg)};">RAM <span class="usage-badge-value">${esc(ramLabel)}</span></span>
          <span class="usage-badge" style="color:${esc(cpuBadge.color)};background:${esc(cpuBadge.bg)};">CPU <span class="usage-badge-value">${esc(cpuLabel)}</span></span>
        </div>
      `;
    }

    function decorate(c) {
      const dot = dotStyle(c.status);
      const health = healthStyle(c.health);
      return {
        ...c,
        dotColor: dot.dot,
        dotGlow: dot.glow,
        statusColor: health.color,
        statusBg: health.bg,
        noPorts: !c.ports || c.ports.length === 0,
      };
    }

    function portHref(port) {
      const scheme = [443, 8443, 9443].includes(port) ? "https" : "http";
      return scheme + "://" + DATA.host + ":" + port;
    }

    function filteredRows() {
      const q = state.query.trim().toLowerCase();
      return DATA.containers.filter((c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.image.toLowerCase().includes(q) ||
        c.stack.toLowerCase().includes(q)
      );
    }

    function isFlatView() {
      return Boolean(state.sortKey);
    }

    function sortRows(rows) {
      const { sortKey, sortDir } = state;
      return [...rows].sort((a, b) => compareRows(a, b, sortKey, sortDir));
    }

    function isEmptyStack(name) {
      return name === "sem stack";
    }

    function compareRows(a, b, sortKey, sortDir) {
      if (!sortKey) return a.name.localeCompare(b.name);
      let r = 0;
      if (sortKey === "name") r = a.name.localeCompare(b.name);
      else if (sortKey === "port") r = (a.ports[0] ?? Infinity) - (b.ports[0] ?? Infinity);
      else if (sortKey === "status") r = uptimeSeconds(a.status) - uptimeSeconds(b.status);
      return r * sortDir;
    }

    function compareStacks(a, b, sortKey, sortDir, map) {
      const aEmpty = isEmptyStack(a);
      const bEmpty = isEmptyStack(b);
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
      if (sortKey) {
        const ca = map[a];
        const cb = map[b];
        if (ca.length && cb.length) {
          const r = compareRows(ca[0], cb[0], sortKey, sortDir);
          if (r !== 0) return r;
        }
      }
      return a.localeCompare(b);
    }

    function groupRowsIntoStacks(rows, { withFavorites = false } = {}) {
      const { sortKey, sortDir } = state;
      const favByName = new Map();
      const restRows = [];
      rows.forEach((c) => {
        if (withFavorites && isFavorite(c.name)) favByName.set(c.name, c);
        else restRows.push(c);
      });
      const favRows = withFavorites
        ? [...favorites].map((name) => favByName.get(name)).filter(Boolean)
        : [];

      const order = [];
      const map = {};
      restRows.forEach((c) => {
        if (!map[c.stack]) { map[c.stack] = []; order.push(c.stack); }
        map[c.stack].push(c);
      });
      for (const name of order) {
        map[name].sort((a, b) => compareRows(a, b, sortKey, sortDir));
      }
      order.sort((a, b) => compareStacks(a, b, sortKey, sortDir, map));

      const stacks = order.map((name) => ({
        name,
        count: map[name].length,
        containers: map[name].map(decorate),
        showTitle: !isEmptyStack(name),
        isFavorites: false,
      }));

      if (favRows.length) {
        stacks.unshift({
          name: "Favoritos",
          count: favRows.length,
          containers: favRows.map(decorate),
          showTitle: true,
          isFavorites: true,
        });
      }

      return stacks;
    }

    function buildLists(rows) {
      const visibleRows = rows.filter((c) => !isHiddenContainer(c));
      const hiddenRows = rows.filter((c) => isHiddenContainer(c));
      if (isFlatView()) {
        const flatSource = state.showHidden ? rows : visibleRows;
        return {
          flat: true,
          flatRows: sortRows(flatSource),
          hiddenCount: hiddenRows.length,
        };
      }
      return {
        flat: false,
        visibleStacks: groupRowsIntoStacks(visibleRows, { withFavorites: true }),
        hiddenStacks: groupRowsIntoStacks(hiddenRows, { withFavorites: false }),
        hiddenCount: hiddenRows.length,
      };
    }

    function esc(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function formatStorageGb(gb) {
      return (gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)) + " GB";
    }

    function renderStorageBar(row) {
      return `
        <div class="storage-row" data-used-gb="${esc(String(row.used_gb))}" data-total-gb="${esc(String(row.total_gb))}">
          <span class="storage-label" title="${esc(row.path)}">${esc(row.label)}</span>
          <div class="storage-bar">
            <span style="width:${esc(String(row.pct))}%;background:${esc(row.color)}"></span>
          </div>
          <span class="storage-pct">${esc(String(row.pct))}%</span>
        </div>
      `;
    }

    const storageTooltip = document.getElementById("storage-tooltip");
    let activeStorageRow = null;

    function showStorageTooltip(row, x, y) {
      const used = Number(row.dataset.usedGb);
      const total = Number(row.dataset.totalGb);
      if (!Number.isFinite(used) || !Number.isFinite(total)) return;
      storageTooltip.textContent = `${formatStorageGb(used)} usados · ${formatStorageGb(total)} disponíveis`;
      storageTooltip.hidden = false;
      positionStorageTooltip(x, y);
    }

    function positionStorageTooltip(x, y) {
      storageTooltip.style.left = x + "px";
      storageTooltip.style.top = y + "px";
    }

    function hideStorageTooltip() {
      activeStorageRow = null;
      storageTooltip.hidden = true;
    }

    function renderMeterExpandBtn(m) {
      if (!m.detailKey) return "";
      return `<button type="button" class="meter-expand-btn" data-meter-detail="${esc(m.detailKey)}" data-meter-label="${esc(m.label)}" title="Expandir ${esc(m.label)}" aria-label="Expandir detalhes de ${esc(m.label)}">${EXPAND_ICON}</button>`;
    }

    function meterBarColor(kind, value) {
      if (kind === "temp") {
        if (value >= 85) return "#f85149";
        if (value >= 65) return "#e3b341";
        return "#3fb950";
      }
      const pct = kind === "cpu" ? value : Math.min(100, value);
      if (pct >= 85) return "#f85149";
      if (pct >= 65) return "#e3b341";
      return "#3fb950";
    }

    function renderDetailRow(row, total, kind) {
      const pct = total > 0 ? Math.min(100, Math.round((row.value / total) * 100)) : 0;
      const color = meterBarColor(kind, kind === "cpu" || kind === "temp" ? row.value : pct);
      const meta = row.writable
        ? `<div class="meter-detail-meta">RW ${esc(row.writable)} · imagem ${esc(row.image)} · volumes ${esc(row.volumes)}</div>`
        : "";
      return `
        <div class="meter-detail-row">
          <div class="meter-detail-info">
            <div class="meter-detail-name" title="${esc(row.name)}">${esc(row.name)}</div>
            ${row.sub ? `<div class="meter-detail-sub">${esc(row.sub)}</div>` : ""}
            ${meta}
          </div>
          <div class="meter-detail-bar"><span style="width:${pct}%;background:${esc(color)}"></span></div>
          <div class="meter-detail-value">${esc(row.display)}</div>
        </div>
      `;
    }

    function renderDetailSection(section, kind, total) {
      const rows = section.rows || [];
      if (!rows.length) {
        return `
          <div class="meter-detail-section">
            <div class="meter-detail-section-title">${esc(section.title)}</div>
            <div class="meter-detail-empty">Nenhum item</div>
          </div>
        `;
      }
      return `
        <div class="meter-detail-section">
          <div class="meter-detail-section-title">${esc(section.title)}</div>
          ${rows.map((row) => renderDetailRow(row, total, kind)).join("")}
        </div>
      `;
    }

    function renderMeterDetailSummary(summary) {
      if (!summary) return "";
      return `
        <div class="meter-detail-summary">
          <div class="meter-detail-summary-sub">${esc(summary.sub || "")}</div>
          <div class="meter-detail-summary-pct">${esc(summary.display || "")}</div>
        </div>
      `;
    }

    function renderMeterDetail(data) {
      if (data.error) {
        return `<div class="meter-detail-error">${esc(data.error)}</div>`;
      }
      const total = data.total || 1;
      const summary = renderMeterDetailSummary(data.summary);
      if (data.sections) {
        return summary + data.sections.map((section) => renderDetailSection(section, data.kind, total)).join("");
      }
      const rows = data.rows || [];
      if (!rows.length) {
        return summary + `<div class="meter-detail-empty">Nenhum dado disponível</div>`;
      }
      return summary + `<div class="meter-detail-section">${rows.map((row) => renderDetailRow(row, total, data.kind)).join("")}</div>`;
    }

    let meterDetailAbort = null;
    let meterDetailTimer = null;
    let meterDetailKind = null;

    function stopMeterDetailRefresh() {
      if (meterDetailTimer) {
        clearInterval(meterDetailTimer);
        meterDetailTimer = null;
      }
    }

    function startMeterDetailRefresh(kind) {
      stopMeterDetailRefresh();
      if (kind !== "cpu") return;
      meterDetailTimer = setInterval(() => {
        if (document.hidden || meterDetailKind !== kind) return;
        loadMeterDetail(kind);
      }, REFRESH_MS);
    }

    async function loadMeterDetail(kind, { initial = false } = {}) {
      const modal = document.getElementById("meter-modal");
      const body = document.getElementById("meter-modal-body");
      if (modal.hidden || meterDetailKind !== kind) return;

      if (meterDetailAbort) {
        meterDetailAbort.abort();
      }
      const ctrl = new AbortController();
      meterDetailAbort = ctrl;

      try {
        const res = await fetch("/api/meters/" + encodeURIComponent(kind), {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (ctrl.signal.aborted || modal.hidden || meterDetailKind !== kind) return;
        body.innerHTML = renderMeterDetail(data);
      } catch (e) {
        if (e && e.name === "AbortError") return;
        if (initial) {
          body.innerHTML = `<div class="meter-detail-error">Falha ao carregar: ${esc(e && e.message ? e.message : e)}</div>`;
        }
      } finally {
        if (meterDetailAbort === ctrl) meterDetailAbort = null;
      }
    }

    function closeMeterDetail() {
      meterDetailKind = null;
      stopMeterDetailRefresh();
      if (meterDetailAbort) {
        meterDetailAbort.abort();
        meterDetailAbort = null;
      }
      document.getElementById("meter-modal").hidden = true;
      releaseBodyScrollIfNoOverlay();
    }

    function getMeterDetailNav() {
      return DATA.meters
        .filter((m) => m.detailKey)
        .map((m) => ({ kind: m.detailKey, label: m.label }));
    }

    function navigateMeterDetail(delta) {
      if (!meterDetailKind) return;
      const nav = getMeterDetailNav();
      const idx = nav.findIndex((item) => item.kind === meterDetailKind);
      if (idx < 0) return;
      const next = nav[(idx + delta + nav.length) % nav.length];
      openMeterDetail(next.kind, next.label);
    }

    async function openMeterDetail(kind, label) {
      if (meterDetailAbort) {
        meterDetailAbort.abort();
        meterDetailAbort = null;
      }
      stopMeterDetailRefresh();
      meterDetailKind = kind;

      const modal = document.getElementById("meter-modal");
      const body = document.getElementById("meter-modal-body");
      document.getElementById("meter-modal-title").textContent = label;
      body.innerHTML = `<div class="meter-detail-loading">Carregando…</div>`;
      modal.hidden = false;
      document.body.style.overflow = "hidden";

      await loadMeterDetail(kind, { initial: true });
      if (meterDetailKind === kind) startMeterDetailRefresh(kind);
    }

    dashboardMeterActions = {
      openDetail(kind, label) {
        openMeterDetail(kind, label);
      },
    };

    function renderMeter(m) {
      if (m.type === "storage") {
        const bars = [renderStorageBar(m.main)]
          .concat((m.mounts || []).map(renderStorageBar))
          .join("");
        return `
          <div class="meter storage">
            ${renderMeterExpandBtn(m)}
            <div class="meter-top">
              <span class="meter-label">${esc(m.label)}</span>
              ${m.showSub ? `<span class="meter-sub">${esc(m.sub)}</span>` : ""}
            </div>
            <div class="meter-value" style="color:${esc(m.color)};margin-top:6px">${esc(m.display)}</div>
            <div class="storage-bars">${bars}</div>
          </div>
        `;
      }

      return `
        <div class="meter">
          ${renderMeterExpandBtn(m)}
          <div class="meter-top">
            <span class="meter-label">${esc(m.label)}</span>
            ${m.showSub ? `<span class="meter-sub">${esc(m.sub)}</span>` : ""}
          </div>
          ${m.showBar ? `
            <div class="meter-value-row">
              <div class="meter-value" style="color:${esc(m.color)}">${esc(m.display)}</div>
              <div class="meter-bar"><span style="width:${esc(m.barWidth)};background:${esc(m.color)}"></span></div>
            </div>
          ` : `<div class="meter-value" style="color:${esc(m.color)};margin-top:6px">${esc(m.display)}</div>`}
          ${m.showChart ? `
            <div class="meter-chart-wrap">
              <div class="meter-chart-axis" aria-hidden="true">
                <span>100</span>
                <span>0</span>
              </div>
              <svg class="meter-chart" data-chart="${esc(m.chartKey)}" viewBox="0 0 200 48" preserveAspectRatio="none" role="img" aria-label="Histórico de uso"></svg>
              <div class="meter-chart-times" data-chart-times="${esc(m.chartKey)}" aria-hidden="true">
                <span></span>
                <span></span>
              </div>
            </div>
          ` : ""}
          ${m.showCaption ? `<div class="meter-caption">${esc(m.caption)}</div>` : ""}
        </div>
      `;
    }

    const CHART_HISTORY_MAX = 60;
    const usageHistory = { cpu: [], ram: [], temp: [] };

    function recordUsageSamples() {
      for (const m of DATA.meters) {
        if (!m.chartKey) continue;
        const bucket = usageHistory[m.chartKey];
        if (!bucket) continue;
        bucket.push({ t: Date.now(), v: m.pct ?? 0 });
        if (bucket.length > CHART_HISTORY_MAX) bucket.shift();
      }
      drawUsageCharts();
    }

    function formatChartTime(ts) {
      return new Date(ts).toLocaleTimeString("pt-BR", {
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      });
    }

    function drawUsageChart(svg, points, color) {
      const W = 200;
      const H = 48;

      if (!points.length) {
        svg.innerHTML = "";
        return;
      }

      const tMin = points[0].t;
      const tMax = points[points.length - 1].t;
      const tSpan = Math.max(tMax - tMin, 1);

      const xAt = (t) => ((t - tMin) / tSpan) * W;
      const yAt = (v) => {
        const clamped = Math.max(0, Math.min(100, v));
        return H - (clamped / 100) * H;
      };

      const coords = points.map((p) => [xAt(p.t), yAt(p.v)]);
      const linePts = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
      const firstX = coords[0][0].toFixed(1);
      const lastX = coords[coords.length - 1][0].toFixed(1);
      const baseY = H.toFixed(1);
      const areaPts = `${firstX},${baseY} ${linePts} ${lastX},${baseY}`;
      const y50 = yAt(50).toFixed(1);

      svg.innerHTML = `
        <line x1="0" y1="${y50}" x2="${W}" y2="${y50}" stroke="${SHADCN.border}" stroke-width="1"/>
        <polygon points="${areaPts}" fill="${esc(color)}" fill-opacity="0.14"/>
        <polyline points="${linePts}" fill="none" stroke="${esc(color)}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      `;

      const wrap = svg.closest(".meter-chart-wrap");
      const times = wrap ? wrap.querySelector(".meter-chart-times") : null;
      if (times) {
        const spans = times.querySelectorAll("span");
        if (spans[0]) spans[0].textContent = formatChartTime(tMin);
        if (spans[1]) spans[1].textContent = formatChartTime(tMax);
      }
    }

    function drawUsageCharts() {
      document.querySelectorAll(".meter-chart").forEach((svg) => {
        const key = svg.dataset.chart;
        const meter = DATA.meters.find((m) => m.chartKey === key);
        const color = meter ? meter.color : "#6cb6ff";
        drawUsageChart(svg, usageHistory[key] || [], color);
      });
    }

    function renderMeters() {
      const el = document.getElementById("meters");
      el.innerHTML = DATA.meters.map(renderMeter).join("");
    }

    function isContainerRunning(status) {
      return (status || "").toLowerCase().startsWith("up");
    }

    function stackHasRunning(stack) {
      return stack.containers.some((c) => isContainerRunning(c.status));
    }

    function renderStackActions(stack) {
      if (stack.isFavorites || !stack.showTitle) return "";
      const running = stackHasRunning(stack);
      const lifecycleBtn = running
        ? `<button type="button" class="name-action-btn stack-action-btn" data-stack-action="stop" data-stack-name="${esc(stack.name)}" title="Parar stack" aria-label="Parar stack ${esc(stack.name)}">${STOP_ICON}</button>`
        : "";
      return `
        <div class="action-group stack-actions">
          ${lifecycleBtn}
          <button type="button" class="name-action-btn stack-action-btn" data-stack-logs="${esc(stack.name)}" title="Ver logs da stack" aria-label="Ver logs da stack ${esc(stack.name)}">${LOGS_ICON}</button>
          <button type="button" class="name-action-btn stack-action-btn" data-stack-action="restart" data-stack-name="${esc(stack.name)}" title="Reiniciar stack" aria-label="Reiniciar stack ${esc(stack.name)}">${RESTART_ICON}</button>
          <button type="button" class="name-action-btn stack-action-btn delete-btn" data-stack-action="delete" data-stack-name="${esc(stack.name)}" title="Apagar stack" aria-label="Apagar stack ${esc(stack.name)}">${TRASH_ICON}</button>
        </div>
      `;
    }

    function renderContainerRow(c) {
      const hidden = isHidden(c.name);
      const running = isContainerRunning(c.status);
      const lifecycleBtn = running
        ? `<button type="button" class="name-action-btn" data-action="stop" data-id="${esc(c.id)}" data-name="${esc(c.name)}" title="Parar" aria-label="Parar ${esc(c.name)}">${STOP_ICON}</button>`
        : `<button type="button" class="name-action-btn" data-action="start" data-id="${esc(c.id)}" data-name="${esc(c.name)}" title="Iniciar" aria-label="Iniciar ${esc(c.name)}">${PLAY_ICON}</button>`;
      return `
        <div class="row${hidden ? " is-hidden" : ""}">
          <div class="row-name">
            <span class="status-dot" style="background:${c.dotColor};box-shadow:0 0 0 3px ${c.dotGlow};"></span>
            <span class="name-text" title="${esc(c.name)}">${esc(c.name)}</span>
          </div>
          <div class="image-text" title="${esc(c.image)}">${esc(c.image)}</div>
          <div class="status-cell">
            <span class="status-pill" style="color:${c.statusColor};background:${c.statusBg}">${esc(c.status)}</span>
          </div>
          <div class="container-actions">
            <div class="action-group">
              ${lifecycleBtn}
              <button type="button" class="name-action-btn" data-action="restart" data-id="${esc(c.id)}" data-name="${esc(c.name)}" title="Reiniciar" aria-label="Reiniciar ${esc(c.name)}">${RESTART_ICON}</button>
              <button type="button" class="name-action-btn delete-btn" data-action="delete" data-id="${esc(c.id)}" data-name="${esc(c.name)}" title="Apagar" aria-label="Apagar ${esc(c.name)}">${TRASH_ICON}</button>
            </div>
          </div>
          <div class="ports">
            ${c.noPorts
              ? `<span class="no-ports">—</span>`
              : c.ports.map((p) =>
                  `<a class="port-link" href="${esc(portHref(p))}" target="_blank" rel="noopener">:${p}</a>`
                ).join("")
            }
          </div>
          <div class="row-actions">
            <button type="button" class="fav-btn${isFavorite(c.name) ? " is-on" : ""}" data-fav="${esc(c.name)}" title="${isFavorite(c.name) ? "Remover dos favoritos" : "Favoritar"}" aria-label="${isFavorite(c.name) ? "Remover " + esc(c.name) + " dos favoritos" : "Favoritar " + esc(c.name)}" aria-pressed="${isFavorite(c.name) ? "true" : "false"}">${STAR_ICON}</button>
            <button type="button" class="hide-btn${hidden ? " is-on" : ""}" data-hide="${esc(c.name)}" title="${hidden ? "Mostrar container" : "Esconder container"}" aria-label="${hidden ? "Mostrar " + esc(c.name) : "Esconder " + esc(c.name)}" aria-pressed="${hidden ? "true" : "false"}">${HIDE_ICON}</button>
            <button type="button" class="logs-btn" data-logs="${esc(c.id)}" data-name="${esc(c.name)}" title="Ver logs" aria-label="Ver logs de ${esc(c.name)}">${LOGS_ICON}</button>
          </div>
          ${renderContainerUsage(c)}
        </div>
      `;
    }

    function renderStackHead(stack, { showStackHide = false } = {}) {
      if (!stack.showTitle) return "";
      const stackHidden = !stack.isFavorites && isHiddenStack(stack.name);
      const collapsed = isStackCollapsed(stack);
      const key = stackKey(stack);
      return `
        <div class="stack-head">
          <span class="stack-name${stack.isFavorites ? " stack-name-icon" : ""}" title="${stack.isFavorites ? "Favoritos" : esc(stack.name)}" aria-label="${stack.isFavorites ? "Favoritos" : esc(stack.name)}">${stack.isFavorites ? STAR_ICON : esc(stack.name)}</span>
          <div class="stack-meta">
            <span class="stack-count">${stack.count}</span>
            <button type="button" class="stack-collapse-btn" data-collapse-stack="${esc(key)}" title="${collapsed ? "Expandir stack" : "Comprimir stack"}" aria-label="${collapsed ? "Expandir stack " + esc(stack.name) : "Comprimir stack " + esc(stack.name)}" aria-expanded="${collapsed ? "false" : "true"}">${collapsed ? CHEVRON_DOWN : CHEVRON_UP}</button>
            ${showStackHide && !stack.isFavorites ? `
              <button type="button" class="hide-btn stack-hide-btn${stackHidden ? " is-on" : ""}" data-hide-stack="${esc(stack.name)}" title="${stackHidden ? "Mostrar stack" : "Esconder stack"}" aria-label="${stackHidden ? "Mostrar stack " + esc(stack.name) : "Esconder stack " + esc(stack.name)}" aria-pressed="${stackHidden ? "true" : "false"}">${HIDE_ICON}</button>
            ` : ""}
            ${renderStackActions(stack)}
          </div>
        </div>
      `;
    }

    function renderStackBlock(stack, { showStackHide = false } = {}) {
      const collapsed = stack.showTitle && isStackCollapsed(stack);
      const rows = stack.containers.map((c) => renderContainerRow(c)).join("");
      return `
        <div class="stack-block${collapsed ? " is-collapsed" : ""}">
          ${renderStackHead(stack, { showStackHide })}
          ${stack.showTitle
            ? `<div class="stack-body"${collapsed ? " hidden" : ""}>${rows}</div>`
            : rows}
        </div>
      `;
    }

    function renderStacksHtml(stacks, { showStackHide = false } = {}) {
      return stacks.map((stack) => renderStackBlock(stack, { showStackHide })).join("");
    }

    function renderFlatList(rows) {
      if (!rows.length) return "";
      return `<div class="flat-list">${rows.map((c) => renderContainerRow(decorate(c))).join("")}</div>`;
    }

    function renderHiddenToggle(hiddenCount) {
      const btn = document.getElementById("hidden-show-toggle");
      if (!btn) return;
      if (!hiddenCount) {
        btn.hidden = true;
        return;
      }
      btn.hidden = false;
      btn.innerHTML = HIDE_ICON;
      btn.classList.toggle("active", state.showHidden);
      const label = state.showHidden
        ? "Ocultar containers escondidos"
        : `Mostrar containers escondidos (${hiddenCount})`;
      btn.title = label;
      btn.setAttribute("aria-label", label);
      btn.setAttribute("aria-pressed", state.showHidden ? "true" : "false");
    }

    function renderSort() {
      document.querySelectorAll(".sort-btn").forEach((btn) => {
        const active = state.sortKey === btn.dataset.key;
        btn.classList.toggle("active", active);
        const arrow = btn.querySelector(".arrow");
        if (arrow) arrow.remove();
        if (active) {
          const span = document.createElement("span");
          span.className = "arrow";
          span.textContent = state.sortDir === 1 ? "▲" : "▼";
          btn.appendChild(span);
        }
      });
    }

    function renderStacks() {
      const rows = filteredRows();
      const lists = buildLists(rows);
      const root = document.getElementById("stacks");
      const hiddenRoot = document.getElementById("hidden-stacks");
      const empty = document.getElementById("empty");

      const err = document.getElementById("error");
      if (DATA.error) {
        err.hidden = false;
        err.textContent = DATA.error;
      } else {
        err.hidden = true;
        err.textContent = "";
      }

      renderHiddenToggle(lists.hiddenCount);

      const hasVisible = lists.flat
        ? lists.flatRows.length > 0
        : lists.visibleStacks.length > 0;
      const showHiddenList = !lists.flat && state.showHidden && lists.hiddenStacks.length > 0;

      if (!hasVisible && !showHiddenList) {
        root.innerHTML = "";
        hiddenRoot.hidden = true;
        hiddenRoot.innerHTML = "";
        empty.hidden = !(rows.length === 0);
        if (!empty.hidden) {
          empty.textContent = state.query.trim()
            ? `Nenhum container corresponde a "${state.query}".`
            : "Nenhum container.";
        }
        return;
      }

      empty.hidden = true;
      root.innerHTML = hasVisible
        ? (lists.flat
          ? renderFlatList(lists.flatRows)
          : renderStacksHtml(lists.visibleStacks, { showStackHide: true }))
        : "";

      if (showHiddenList) {
        hiddenRoot.hidden = false;
        hiddenRoot.innerHTML = renderStacksHtml(lists.hiddenStacks, { showStackHide: true });
      } else {
        hiddenRoot.hidden = true;
        hiddenRoot.innerHTML = "";
      }
    }

    function syncBridgeSnapshot() {
      if (!bridge) return;
      bridge.getSnapshot = () => ({
        favorites: [...favorites],
        hiddenContainers: [...hiddenContainers],
        hiddenStacks: [...hiddenStacks],
        collapsedStacks: [...collapsedStacks],
        settings: { ...settings },
        view: {
          query: state.query,
          sortKey: state.sortKey,
          sortDir: state.sortDir,
          showHidden: state.showHidden,
        },
      });
    }

    function render() {
      if (!reactMode) {
        renderSort();
        const rows = filteredRows();
        const lists = buildLists(rows);
        renderHiddenToggle(lists.hiddenCount);
      }
      if (reactMode) {
        syncBridgeSnapshot();
        bridge.onUiBump?.();
      } else {
        renderStacks();
      }
    }

    dashboardViewActions = {
      setQuery(query) {
        state.query = query;
        render();
      },
      toggleSort(key) {
        toggleSort(key);
      },
      toggleShowHidden() {
        toggleShowHidden();
      },
    };

    function toggleSort(key) {
      if (state.sortKey === key) {
        if (state.sortDir === 1) state.sortDir = -1;
        else { state.sortKey = null; state.sortDir = 1; }
      } else {
        state.sortKey = key;
        state.sortDir = 1;
      }
      render();
    }

    async function refresh() {
      if (refreshing || document.hidden) return;
      refreshing = true;
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        DATA = await res.json();
        if (DATA.build && DATA.build !== APP_BUILD) {
          APP_BUILD = DATA.build;
        }
        setClock();
        if (reactMode) {
          bridge.onDataUpdate?.(DATA);
        } else {
          renderMeters();
          recordUsageSamples();
          render();
        }
      } catch (e) {
        const err = document.getElementById("error");
        err.hidden = false;
        err.textContent = "Falha ao atualizar: " + (e && e.message ? e.message : e);
      } finally {
        refreshing = false;
      }
    }

    function setLogsLive(live) {
      const badge = document.getElementById("logs-live");
      const text = document.getElementById("logs-live-text");
      badge.classList.toggle("is-idle", !live);
      text.textContent = live ? "Ao vivo" : "Parado";
    }

    function resetCopyBtn() {
      const btn = document.getElementById("logs-copy");
      if (copyResetTimer) {
        clearTimeout(copyResetTimer);
        copyResetTimer = null;
      }
      btn.classList.remove("is-copied");
      btn.innerHTML = COPY_ICON;
      btn.title = "Copiar logs";
      btn.setAttribute("aria-label", "Copiar logs");
    }

    function closeLogs() {
      if (logsAbort) {
        logsAbort.abort();
        logsAbort = null;
      }
      setLogsLive(false);
      resetCopyBtn();
      document.getElementById("logs-progress").hidden = true;
      document.getElementById("logs-progress-bar").style.width = "0%";
      document.getElementById("logs-modal").hidden = true;
      releaseBodyScrollIfNoOverlay();
    }

    function appendLogs(text) {
      const view = document.getElementById("logs-view");
      const scroller = document.getElementById("logs-scroll");
      if (logsStackColors) {
        appendStackLogsChunk(view, text);
      } else {
        view.textContent += text;
      }
      if (logsStickBottom) scroller.scrollTop = scroller.scrollHeight;
      updateScrollProgress();
    }

    function updateScrollProgress() {
      const el = document.getElementById("logs-scroll");
      const bar = document.getElementById("logs-progress");
      const fill = document.getElementById("logs-progress-bar");
      const max = el.scrollHeight - el.clientHeight;
      const atBottom = max <= 0 || el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
      logsStickBottom = atBottom;
      if (atBottom) {
        bar.hidden = true;
        fill.style.width = "0%";
        return;
      }
      bar.hidden = false;
      const pct = Math.max(0, Math.min(100, (el.scrollTop / max) * 100));
      fill.style.width = pct.toFixed(2) + "%";
    }

    async function streamLogsToModal(url, title, options = {}) {
      closeLogs();
      const modal = document.getElementById("logs-modal");
      const view = document.getElementById("logs-view");
      const scroller = document.getElementById("logs-scroll");
      document.getElementById("logs-modal-title").textContent = title;
      logsStackColors = Boolean(options.stackColors);
      logsStackLinePending = "";
      view.textContent = "";
      logsStickBottom = true;
      document.getElementById("logs-progress").hidden = true;
      document.getElementById("logs-progress-bar").style.width = "0%";
      modal.hidden = false;
      document.body.style.overflow = "hidden";
      setLogsLive(true);

      const ctrl = new AbortController();
      logsAbort = ctrl;
      try {
        const res = await fetch(url, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || ("HTTP " + res.status));
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          appendLogs(decoder.decode(value, { stream: true }));
        }
        appendLogs(decoder.decode());
        if (logsStackColors) flushStackLogLinePending();
      } catch (e) {
        if (e && e.name === "AbortError") return;
        appendLogs("\\n[erro] " + (e && e.message ? e.message : e) + "\\n");
        if (logsStackColors) flushStackLogLinePending();
      } finally {
        if (logsAbort === ctrl) {
          logsAbort = null;
          setLogsLive(false);
        }
      }
    }

    function openLogs(id, name) {
      return streamLogsToModal(
        "/api/logs/" + encodeURIComponent(id),
        name,
      );
    }

    function openStackLogs(stackName) {
      return streamLogsToModal(
        "/api/logs/stack/" + encodeURIComponent(stackName),
        "Stack " + stackName,
        { stackColors: true },
      );
    }

    async function copyLogs() {
      const text = document.getElementById("logs-view").textContent || "";
      if (!text) return;
      const btn = document.getElementById("logs-copy");
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
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
      btn.innerHTML = CHECK_ICON;
      btn.title = "Copiado";
      btn.setAttribute("aria-label", "Logs copiados");
      if (copyResetTimer) clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => {
        btn.classList.remove("is-copied");
        btn.innerHTML = COPY_ICON;
        btn.title = "Copiar logs";
        btn.setAttribute("aria-label", "Copiar logs");
      }, 1600);
    }

    function clearLogs() {
      const view = document.getElementById("logs-view");
      if (!view.textContent && !view.childElementCount) return;
      view.textContent = "";
      logsStackLinePending = "";
      logsStickBottom = true;
      document.getElementById("logs-progress").hidden = true;
      document.getElementById("logs-progress-bar").style.width = "0%";
      document.getElementById("logs-scroll").scrollTop = 0;
    }

    if (!reactMode) {
      document.addEventListener("click", (e) => {
        const expand = e.target.closest("[data-meter-detail]");
        if (!expand || !expand.closest("#meters")) return;
        openMeterDetail(
          expand.dataset.meterDetail,
          expand.dataset.meterLabel || expand.dataset.meterDetail,
        );
      });
    }

    document.addEventListener("pointerover", (e) => {
      const row = e.target.closest("#meters .storage-row");
      if (!row) return;
      activeStorageRow = row;
      showStorageTooltip(row, e.clientX, e.clientY);
    });

    document.addEventListener("pointermove", (e) => {
      if (!activeStorageRow || storageTooltip.hidden) return;
      const row = e.target.closest("#meters .storage-row");
      if (row !== activeStorageRow) return;
      positionStorageTooltip(e.clientX, e.clientY);
    });

    document.addEventListener("pointerout", (e) => {
      const row = e.target.closest("#meters .storage-row");
      if (!row || row !== activeStorageRow) return;
      const next = e.relatedTarget;
      if (next && row.contains(next)) return;
      hideStorageTooltip();
    });

    function actionStartMessage(action, name, isStack) {
      const labels = ACTION_LABELS[action];
      if (!labels) return `Executando ${action}…`;
      return isStack
        ? `${labels.verb} stack "${name}"…`
        : `${labels.verb} container "${name}"…`;
    }

    function actionSuccessMessage(action, name, isStack) {
      const labels = ACTION_LABELS[action];
      if (!labels) return "Ação concluída.";
      const done = isStack ? labels.stackDone : labels.done;
      return isStack
        ? `Stack "${name}" ${done}.`
        : `Container "${name}" ${done}.`;
    }

    function showToast(message, type = "info", duration = 4500) {
      const container = document.getElementById("toast-container");
      if (!container) {
        return {
          update() {},
          remove() {},
        };
      }
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

    function formatActionError(err) {
      const msg = err && err.message ? err.message : String(err);
      if (msg === "Failed to fetch" || msg === "NetworkError when attempting to fetch resource.") {
        return "Conexão perdida com o servidor (operação demorou demais ou o serviço reiniciou).";
      }
      return msg;
    }

    async function containerAction(id, name, action) {
      if (action === "delete") {
        if (!confirm(`Apagar o container "${name}"? Esta ação não pode ser desfeita.`)) return;
      }
      const toast = showToast(actionStartMessage(action, name, false), "info", 0);
      const url = action === "delete"
        ? `/api/containers/${encodeURIComponent(id)}`
        : `/api/containers/${encodeURIComponent(id)}/${action}`;
      try {
        const res = await fetch(url, {
          method: action === "delete" ? "DELETE" : "POST",
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
        toast.update(actionSuccessMessage(action, name, false), "success");
        refreshing = false;
        await refresh();
      } catch (err) {
        toast.remove();
        showToast(
          "Falha ao executar ação: " + formatActionError(err),
          "error",
          6000,
        );
      }
    }

    async function stackAction(stackName, action) {
      if (action === "delete") {
        if (!confirm(`Apagar todos os containers da stack "${stackName}"? Esta ação não pode ser desfeita.`)) return;
      }
      const toast = showToast(actionStartMessage(action, stackName, true), "info", 0);
      const enc = encodeURIComponent(stackName);
      const url = action === "delete"
        ? `/api/stacks/${enc}`
        : `/api/stacks/${enc}/${action}`;
      try {
        const res = await fetch(url, {
          method: action === "delete" ? "DELETE" : "POST",
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
        toast.update(actionSuccessMessage(action, stackName, true), "success");
        refreshing = false;
        await refresh();
      } catch (err) {
        toast.remove();
        showToast(
          "Falha na stack: " + formatActionError(err),
          "error",
          6000,
        );
      }
    }

    function handleStacksClick(e) {
      const stackLogsBtn = e.target.closest("[data-stack-logs]");
      if (stackLogsBtn) {
        openStackLogs(stackLogsBtn.dataset.stackLogs);
        return;
      }
      const stackActionBtn = e.target.closest("[data-stack-action]");
      if (stackActionBtn) {
        stackAction(stackActionBtn.dataset.stackName, stackActionBtn.dataset.stackAction);
        return;
      }
      const actionBtn = e.target.closest("[data-action]");
      if (actionBtn) {
        containerAction(actionBtn.dataset.id, actionBtn.dataset.name, actionBtn.dataset.action);
        return;
      }
      const fav = e.target.closest("[data-fav]");
      if (fav) {
        toggleFavorite(fav.dataset.fav);
        return;
      }
      const collapseStack = e.target.closest("[data-collapse-stack]");
      if (collapseStack) {
        toggleStackCollapsed(collapseStack.dataset.collapseStack);
        return;
      }
      const hideStack = e.target.closest("[data-hide-stack]");
      if (hideStack) {
        toggleHiddenStack(hideStack.dataset.hideStack);
        return;
      }
      const hide = e.target.closest("[data-hide]");
      if (hide) {
        toggleHidden(hide.dataset.hide);
        return;
      }
      const btn = e.target.closest("[data-logs]");
      if (!btn) return;
      openLogs(btn.dataset.logs, btn.dataset.name);
    }

    const stacksEl = document.getElementById("stacks");
    const hiddenStacksEl = document.getElementById("hidden-stacks");
    stacksEl?.addEventListener("click", handleStacksClick);
    hiddenStacksEl?.addEventListener("click", handleStacksClick);

    dashboardInteractionActions = {
      toggleHiddenStack,
      toggleHidden,
      toggleFavorite,
      toggleStackCollapsed,
    };

    dashboardLifecycleActions = {
      container: containerAction,
      stack: stackAction,
    };

    dashboardLogsActions = {
      open: openLogs,
      openStack: openStackLogs,
    };

    const fullscreenToggle = document.getElementById("fullscreen-toggle");
    if (document.fullscreenEnabled && fullscreenToggle) {
      fullscreenToggle.addEventListener("click", toggleFullscreen);
      document.addEventListener("fullscreenchange", updateFullscreenButton);
    } else if (fullscreenToggle) {
      fullscreenToggle.hidden = true;
    }

    document.getElementById("meter-close").addEventListener("click", closeMeterDetail);
    document.getElementById("meter-prev").addEventListener("click", () => navigateMeterDetail(-1));
    document.getElementById("meter-next").addEventListener("click", () => navigateMeterDetail(1));
    document.getElementById("meter-modal").addEventListener("click", (e) => {
      if (e.target.id === "meter-modal") closeMeterDetail();
    });

    document.getElementById("logs-close").addEventListener("click", closeLogs);
    document.getElementById("logs-copy").addEventListener("click", copyLogs);
    document.getElementById("logs-clear").addEventListener("click", clearLogs);
    document.getElementById("logs-modal").addEventListener("click", (e) => {
      if (e.target.id === "logs-modal") closeLogs();
    });
    document.getElementById("logs-scroll").addEventListener("scroll", updateScrollProgress);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!document.getElementById("meter-modal").hidden) closeMeterDetail();
      else if (!document.getElementById("logs-modal").hidden) closeLogs();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (!reactPolling) refresh();
      if (meterDetailKind === "cpu" && !document.getElementById("meter-modal").hidden) {
        loadMeterDetail("cpu");
      }
    });

    let refreshTimer = null;

    syncBridgeSnapshot();

    loadPrefs().then(() => {
      applySettings();
      setClock();
      if (reactMode) {
        syncBridgeSnapshot();
        bridge.onUiBump?.();
        render();
      } else {
        renderMeters();
        recordUsageSamples();
        render();
      }
      if (!reactPolling) {
        refreshTimer = setInterval(refresh, REFRESH_MS);
      }
    }).catch((e) => {
      const err = document.getElementById("error");
      err.hidden = false;
      err.textContent = "Falha ao carregar preferências: " + (e && e.message ? e.message : e);
    });

    function wrappedCleanup() {
      if (refreshTimer) clearInterval(refreshTimer);
      stopMeterDetailRefresh();
      if (logsAbort) {
        logsAbort.abort();
        logsAbort = null;
      }
      stacksEl?.removeEventListener("click", handleStacksClick);
      hiddenStacksEl?.removeEventListener("click", handleStacksClick);
      dashboardViewActions = null;
      dashboardMeterActions = null;
      dashboardInteractionActions = null;
      dashboardLifecycleActions = null;
      dashboardLogsActions = null;
      setVerticalMetersFn = null;
      setCompactViewFn = null;
      setTruncateNamesFn = null;
      if (dashboardControllerCleanup === wrappedCleanup) {
        dashboardControllerCleanup = null;
      }
    }

    dashboardControllerCleanup = wrappedCleanup;
    return wrappedCleanup;
}
