"use client";

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent,
} from "react";
import { SHADCN } from "@/lib/shadcn-theme";
import {
  openDashboardLogs,
  openDashboardStackLogs,
  openDashboardMeterDetail,
  runDashboardContainerAction,
  runDashboardStackAction,
  toggleDashboardFavorite,
  toggleDashboardHiddenContainer,
  toggleDashboardHiddenStack,
  toggleDashboardStackCollapsed,
} from "@/lib/dashboard-client";
import type { PagePayload } from "@/lib/metrics-cache";
import {
  buildLists,
  decorate,
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
} from "@/lib/dashboard-view-model";

const CHART_HISTORY_MAX = 60;
type ChartPoint = { t: number; v: number };
const chartHistories = new Map<string, ChartPoint[]>();

function formatStorageGb(gb: number) {
  return (gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)) + " GB";
}

function MeterChart({
  chartKey,
  color,
  pct,
}: {
  chartKey: string;
  color: string;
  pct: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let bucket = chartHistories.get(chartKey);
    if (!bucket) {
      bucket = [];
      chartHistories.set(chartKey, bucket);
    }
    bucket.push({ t: Date.now(), v: pct ?? 0 });
    if (bucket.length > CHART_HISTORY_MAX) bucket.shift();

    const svg = svgRef.current;
    if (!svg) return;
    const points = bucket;
    const W = 200;
    const H = 48;

    if (!points.length) {
      svg.innerHTML = "";
      return;
    }

    const tMin = points[0].t;
    const tMax = points[points.length - 1].t;
    const tSpan = Math.max(tMax - tMin, 1);
    const xAt = (t: number) => ((t - tMin) / tSpan) * W;
    const yAt = (v: number) => {
      const clamped = Math.max(0, Math.min(100, v));
      return H - (clamped / 100) * H;
    };

    const coords = points.map((p) => [xAt(p.t), yAt(p.v)] as const);
    const linePts = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const firstX = coords[0][0].toFixed(1);
    const lastX = coords[coords.length - 1][0].toFixed(1);
    const baseY = H.toFixed(1);
    const areaPts = `${firstX},${baseY} ${linePts} ${lastX},${baseY}`;
    const y50 = yAt(50).toFixed(1);

    svg.innerHTML = `
      <line x1="0" y1="${y50}" x2="${W}" y2="${y50}" stroke="${SHADCN.border}" stroke-width="1"/>
      <polygon points="${areaPts}" fill="${color}" fill-opacity="0.14"/>
      <polyline points="${linePts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    `;

    const wrap = svg.closest(".meter-chart-wrap");
    const times = wrap?.querySelector(".meter-chart-times");
    if (times) {
      const spans = times.querySelectorAll("span");
      const fmt = (ts: number) =>
        new Date(ts).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
      if (spans[0]) spans[0].textContent = fmt(tMin);
      if (spans[1]) spans[1].textContent = fmt(tMax);
    }
  }, [chartKey, color, pct]);

  return (
    <svg
      ref={svgRef}
      className="meter-chart"
      data-chart={chartKey}
      viewBox="0 0 200 48"
      preserveAspectRatio="none"
      role="img"
      aria-label="Histórico de uso"
    />
  );
}

type ContainerLifecycleAction = "start" | "stop" | "restart" | "delete";

function onContainerLifecycleClick(
  e: MouseEvent,
  id: string,
  name: string,
  action: ContainerLifecycleAction,
) {
  e.stopPropagation();
  runDashboardContainerAction(id, name, action);
}

function onStackLifecycleClick(
  e: MouseEvent,
  stackName: string,
  action: ContainerLifecycleAction,
) {
  e.stopPropagation();
  runDashboardStackAction(stackName, action);
}

function ContainerUsageCell({ c }: { c: DecoratedContainer }) {
  const running = isContainerRunning(c.status);
  const ramPct = running ? (c.memPct ?? 0) : null;
  const cpuPct = running ? (c.cpuPct ?? 0) : null;
  const ramLabel = running && ramPct != null ? formatPct(ramPct) : "—";
  const cpuLabel = running && cpuPct != null ? formatPct(cpuPct) : "—";
  const title = running
    ? `RAM ${ramLabel} · CPU ${cpuLabel}`
    : "Container parado";
  const ramBadge = usageMetricBadgeStyle(ramPct, running);
  const cpuBadge = usageMetricBadgeStyle(cpuPct, running);

  return (
    <div className="container-usage" title={title}>
      <span
        className="usage-badge"
        style={{ color: ramBadge.color, background: ramBadge.bg }}
      >
        RAM{" "}
        <span className="usage-badge-value">{ramLabel}</span>
      </span>
      <span
        className="usage-badge"
        style={{ color: cpuBadge.color, background: cpuBadge.bg }}
      >
        CPU{" "}
        <span className="usage-badge-value">{cpuLabel}</span>
      </span>
    </div>
  );
}

const ContainerRowView = memo(function ContainerRowView({
  c,
  host,
  prefs,
  containers,
}: {
  c: DecoratedContainer;
  host: string;
  prefs: DashboardPrefsSnapshot;
  containers: PagePayload["containers"];
}) {
  const favorites = useMemo(() => new Set(prefs.favorites), [prefs.favorites]);
  const hidden = isHiddenByName(c.name, containers, prefs);
  const running = isContainerRunning(c.status);
  const isFav = favorites.has(c.name);

  return (
    <div className={`row${hidden ? " is-hidden" : ""}`}>
      <div className="row-name">
        <span
          className="status-dot"
          style={{
            background: c.dotColor,
            boxShadow: `0 0 0 3px ${c.dotGlow}`,
          }}
        />
        <span className="name-text" title={c.name}>
          {c.name}
        </span>
      </div>
      <div className="image-text" title={c.image}>
        {c.image}
      </div>
      <div className="status-cell">
        <span
          className="status-pill"
          style={{ color: c.statusColor, background: c.statusBg }}
        >
          {c.status}
        </span>
      </div>
      <div className="container-actions">
        <div className="action-group">
          {running ? (
            <button
              type="button"
              className="name-action-btn"
              data-action="stop"
              data-id={c.id}
              data-name={c.name}
              title="Parar"
              aria-label={`Parar ${c.name}`}
              onClick={(e) => onContainerLifecycleClick(e, c.id, c.name, "stop")}
            >
              <StopIcon />
            </button>
          ) : (
            <button
              type="button"
              className="name-action-btn"
              data-action="start"
              data-id={c.id}
              data-name={c.name}
              title="Iniciar"
              aria-label={`Iniciar ${c.name}`}
              onClick={(e) => onContainerLifecycleClick(e, c.id, c.name, "start")}
            >
              <PlayIcon />
            </button>
          )}
          <button
            type="button"
            className="name-action-btn"
            data-action="restart"
            data-id={c.id}
            data-name={c.name}
            title="Reiniciar"
            aria-label={`Reiniciar ${c.name}`}
            onClick={(e) =>
              onContainerLifecycleClick(e, c.id, c.name, "restart")
            }
          >
            <RestartIcon />
          </button>
          <button
            type="button"
            className="name-action-btn delete-btn"
            data-action="delete"
            data-id={c.id}
            data-name={c.name}
            title="Apagar"
            aria-label={`Apagar ${c.name}`}
            onClick={(e) => onContainerLifecycleClick(e, c.id, c.name, "delete")}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
      <div className="ports">
        {c.noPorts ? (
          <span className="no-ports">—</span>
        ) : (
          c.ports.map((p) => (
            <a
              key={p}
              className="port-link"
              href={portHref(host, p)}
              target="_blank"
              rel="noopener"
            >
              :{p}
            </a>
          ))
        )}
      </div>
      <div className="row-actions">
        <button
          type="button"
          className={`fav-btn${isFav ? " is-on" : ""}`}
          data-fav={c.name}
          title={isFav ? "Remover dos favoritos" : "Favoritar"}
          aria-label={
            isFav ? `Remover ${c.name} dos favoritos` : `Favoritar ${c.name}`
          }
          aria-pressed={isFav}
          onClick={(e) => {
            e.stopPropagation();
            toggleDashboardFavorite(c.name);
          }}
        >
          <StarIcon />
        </button>
        <button
          type="button"
          className={`hide-btn${hidden ? " is-on" : ""}`}
          data-hide={c.name}
          title={hidden ? "Mostrar container" : "Esconder container"}
          aria-label={hidden ? `Mostrar ${c.name}` : `Esconder ${c.name}`}
          aria-pressed={hidden}
          onClick={(e) => {
            e.stopPropagation();
            toggleDashboardHiddenContainer(c.name);
          }}
        >
          <HideIcon />
        </button>
        <button
          type="button"
          className="logs-btn"
          data-logs={c.id}
          data-name={c.name}
          title="Ver logs"
          aria-label={`Ver logs de ${c.name}`}
          onClick={(e) => {
            e.stopPropagation();
            openDashboardLogs(c.id, c.name);
          }}
        >
          <LogsIcon />
        </button>
      </div>
      <ContainerUsageCell c={c} />
    </div>
  );
}, rowPropsEqual);

function rowPropsEqual(
  prev: {
    c: DecoratedContainer;
    host: string;
    prefs: DashboardPrefsSnapshot;
    containers: PagePayload["containers"];
  },
  next: typeof prev,
) {
  if (prev.host !== next.host || prev.c.id !== next.c.id) return false;
  if (
    prev.c.status !== next.c.status ||
    prev.c.cpuPct !== next.c.cpuPct ||
    prev.c.memPct !== next.c.memPct ||
    prev.c.image !== next.c.image ||
    prev.c.name !== next.c.name
  ) {
    return false;
  }
  if (prev.containers !== next.containers) {
    /* lista nova do payload — deixa o React decidir */
  }
  return (
    JSON.stringify(prev.prefs.favorites) ===
      JSON.stringify(next.prefs.favorites) &&
    JSON.stringify(prev.prefs.hiddenContainers) ===
      JSON.stringify(next.prefs.hiddenContainers) &&
    JSON.stringify(prev.prefs.hiddenStacks) ===
      JSON.stringify(next.prefs.hiddenStacks) &&
    prev.prefs.view.query === next.prefs.view.query &&
    prev.prefs.view.sortKey === next.prefs.view.sortKey &&
    prev.prefs.view.sortDir === next.prefs.view.sortDir &&
    prev.prefs.view.showHidden === next.prefs.view.showHidden
  );
}

function StackBlockView({
  stack,
  host,
  prefs,
  containers,
  showStackHide,
}: {
  stack: StackBlock;
  host: string;
  prefs: DashboardPrefsSnapshot;
  containers: PagePayload["containers"];
  showStackHide?: boolean;
}) {
  const collapsedStacks = useMemo(
    () => new Set(prefs.collapsedStacks),
    [prefs.collapsedStacks],
  );
  const hiddenStacks = useMemo(
    () => new Set(prefs.hiddenStacks),
    [prefs.hiddenStacks],
  );
  const collapsed = stack.showTitle && isStackCollapsed(stack, collapsedStacks);
  const stackHidden =
    !stack.isFavorites && hiddenStacks.has(stack.name);
  const key = stackKey(stack);
  const running = stack.containers.some((c) =>
    isContainerRunning(c.status),
  );

  return (
    <div className={`stack-block${collapsed ? " is-collapsed" : ""}`}>
      {stack.showTitle ? (
        <div className="stack-head">
          <span
            className={`stack-name${stack.isFavorites ? " stack-name-icon" : ""}`}
            title={stack.isFavorites ? "Favoritos" : stack.name}
            aria-label={stack.isFavorites ? "Favoritos" : stack.name}
          >
            {stack.isFavorites ? <StarIcon /> : stack.name}
          </span>
          <div className="stack-meta">
            <span className="stack-count">{stack.count}</span>
            <button
              type="button"
              className="stack-collapse-btn"
              data-collapse-stack={key}
              title={collapsed ? "Expandir stack" : "Comprimir stack"}
              aria-label={
                collapsed
                  ? `Expandir stack ${stack.name}`
                  : `Comprimir stack ${stack.name}`
              }
              aria-expanded={!collapsed}
              onClick={(e) => {
                e.stopPropagation();
                toggleDashboardStackCollapsed(key);
              }}
            >
              {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
            </button>
            {showStackHide && !stack.isFavorites ? (
              <button
                type="button"
                className={`hide-btn stack-hide-btn${stackHidden ? " is-on" : ""}`}
                data-hide-stack={stack.name}
                title={stackHidden ? "Mostrar stack" : "Esconder stack"}
                aria-label={
                  stackHidden
                    ? `Mostrar stack ${stack.name}`
                    : `Esconder stack ${stack.name}`
                }
                aria-pressed={stackHidden}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleDashboardHiddenStack(stack.name);
                }}
              >
                <HideIcon />
              </button>
            ) : null}
            {!stack.isFavorites && stack.showTitle ? (
              <div className="action-group stack-actions">
                {running ? (
                  <button
                    type="button"
                    className="name-action-btn stack-action-btn"
                    data-stack-action="stop"
                    data-stack-name={stack.name}
                    title="Parar stack"
                    aria-label={`Parar stack ${stack.name}`}
                    onClick={(e) =>
                      onStackLifecycleClick(e, stack.name, "stop")
                    }
                  >
                    <StopIcon />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="name-action-btn stack-action-btn"
                  data-stack-logs={stack.name}
                  title="Ver logs da stack"
                  aria-label={`Ver logs da stack ${stack.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    openDashboardStackLogs(stack.name);
                  }}
                >
                  <LogsIcon />
                </button>
                <button
                  type="button"
                  className="name-action-btn stack-action-btn"
                  data-stack-action="restart"
                  data-stack-name={stack.name}
                  title="Reiniciar stack"
                  aria-label={`Reiniciar stack ${stack.name}`}
                  onClick={(e) =>
                    onStackLifecycleClick(e, stack.name, "restart")
                  }
                >
                  <RestartIcon />
                </button>
                <button
                  type="button"
                  className="name-action-btn stack-action-btn delete-btn"
                  data-stack-action="delete"
                  data-stack-name={stack.name}
                  title="Apagar stack"
                  aria-label={`Apagar stack ${stack.name}`}
                  onClick={(e) =>
                    onStackLifecycleClick(e, stack.name, "delete")
                  }
                >
                  <TrashIcon />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {stack.showTitle ? (
        <div className="stack-body" hidden={collapsed}>
          {stack.containers.map((c) => (
            <ContainerRowView
              key={c.id}
              c={c}
              host={host}
              prefs={prefs}
              containers={containers}
            />
          ))}
        </div>
      ) : (
        stack.containers.map((c) => (
          <ContainerRowView
            key={c.id}
            c={c}
            host={host}
            prefs={prefs}
            containers={containers}
          />
        ))
      )}
    </div>
  );
}

function StorageRow({
  row,
}: {
  row: {
    path: string;
    label: string;
    pct: number;
    color: string;
    used_gb: number;
    total_gb: number;
  };
}) {
  return (
    <div
      className="storage-row"
      data-used-gb={String(row.used_gb)}
      data-total-gb={String(row.total_gb)}
    >
      <span className="storage-label" title={row.path}>
        {row.label}
      </span>
      <div className="storage-bar">
        <span style={{ width: `${row.pct}%`, background: row.color }} />
      </div>
      <span className="storage-pct">{row.pct}%</span>
    </div>
  );
}

function MeterChartSection({
  chartKey,
  color,
  pct,
}: {
  chartKey: string;
  color: string;
  pct: number;
}) {
  return (
    <div className="meter-chart-wrap">
      <div className="meter-chart-axis" aria-hidden="true">
        <span>100</span>
        <span>0</span>
      </div>
      <MeterChart chartKey={chartKey} color={color} pct={pct} />
      <div
        className="meter-chart-times"
        data-chart-times={chartKey}
        aria-hidden="true"
      >
        <span />
        <span />
      </div>
    </div>
  );
}

function metersEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
) {
  return (
    a.label === b.label &&
    a.display === b.display &&
    a.barWidth === b.barWidth &&
    a.color === b.color &&
    a.pct === b.pct &&
    a.sub === b.sub &&
    a.type === b.type &&
    JSON.stringify(a.main) === JSON.stringify(b.main) &&
    JSON.stringify(a.mounts) === JSON.stringify(b.mounts)
  );
}

function openMeterFromCard(m: Record<string, unknown>) {
  if (!m.detailKey) return;
  openDashboardMeterDetail(String(m.detailKey), String(m.label));
}

const MeterView = memo(function MeterView({
  m,
}: {
  m: Record<string, unknown>;
}) {
  const type = m.type as string | undefined;
  if (type === "storage") {
    const main = m.main as Parameters<typeof StorageRow>[0]["row"];
    const mounts = (m.mounts as Parameters<typeof StorageRow>[0]["row"][]) || [];
    return (
      <div className="meter storage">
        {m.detailKey ? (
          <button
            type="button"
            className="meter-expand-btn"
            data-meter-detail={String(m.detailKey)}
            data-meter-label={String(m.label)}
            title={`Expandir ${String(m.label)}`}
            aria-label={`Expandir detalhes de ${String(m.label)}`}
            onClick={() => openMeterFromCard(m)}
          >
            <ExpandIcon />
          </button>
        ) : null}
        <div className="meter-top">
          <span className="meter-label">{String(m.label)}</span>
          {m.showSub ? (
            <span className="meter-sub">{String(m.sub)}</span>
          ) : null}
        </div>
        <div
          className="meter-value"
          style={{ color: String(m.color), marginTop: 6 }}
        >
          {String(m.display)}
        </div>
        <div className="storage-bars">
          <StorageRow row={main} />
          {mounts.map((row, i) => (
            <StorageRow key={row.path ?? i} row={row} />
          ))}
        </div>
      </div>
    );
  }

  const chartKey = m.chartKey as string | undefined;
  const showChart = Boolean(m.showChart);

  return (
    <div className="meter">
      {m.detailKey ? (
        <button
          type="button"
          className="meter-expand-btn"
          data-meter-detail={String(m.detailKey)}
          data-meter-label={String(m.label)}
          title={`Expandir ${String(m.label)}`}
          aria-label={`Expandir detalhes de ${String(m.label)}`}
          onClick={() => openMeterFromCard(m)}
        >
          <ExpandIcon />
        </button>
      ) : null}
      <div className="meter-top">
        <span className="meter-label">{String(m.label)}</span>
        {m.showSub ? (
          <span className="meter-sub">{String(m.sub)}</span>
        ) : null}
      </div>
      {m.showBar ? (
        <div className="meter-value-row">
          <div className="meter-value" style={{ color: String(m.color) }}>
            {String(m.display)}
          </div>
          <div className="meter-bar">
            <span
              style={{
                width: String(m.barWidth),
                background: String(m.color),
              }}
            />
          </div>
        </div>
      ) : (
        <div
          className="meter-value"
          style={{ color: String(m.color), marginTop: 6 }}
        >
          {String(m.display)}
        </div>
      )}
      {showChart && chartKey ? (
        <MeterChartSection
          chartKey={chartKey}
          color={String(m.color)}
          pct={(m.pct as number) ?? 0}
        />
      ) : null}
      {m.showCaption ? (
        <div className="meter-caption">{String(m.caption)}</div>
      ) : null}
    </div>
  );
}, (prev, next) => metersEqual(prev.m, next.m));

export const DashboardMeters = memo(function DashboardMeters({
  meters,
}: {
  meters: PagePayload["meters"];
}) {
  return (
    <>
      {meters.map((m, i) => (
        <MeterView key={(m.label as string) ?? i} m={m} />
      ))}
    </>
  );
});

function useContainerLists(data: PagePayload, prefs: DashboardPrefsSnapshot) {
  return useMemo(() => {
    const rows = filteredRows(data.containers, prefs.view.query);
    const lists = buildLists(data.containers, prefs);
    const hasVisible = lists.flat
      ? (lists.flatRows?.length ?? 0) > 0
      : (lists.visibleStacks?.length ?? 0) > 0;
    const showHiddenList =
      !lists.flat &&
      prefs.view.showHidden &&
      (lists.hiddenStacks?.length ?? 0) > 0;
    return { rows, lists, hasVisible, showHiddenList };
  }, [data, prefs]);
}

export function DashboardStacksContent({
  data,
  prefs,
}: {
  data: PagePayload;
  prefs: DashboardPrefsSnapshot;
}) {
  const { lists, hasVisible } = useContainerLists(data, prefs);

  if (!hasVisible) return null;

  if (lists.flat) {
    return (
      <div className="flat-list">
        {lists.flatRows?.map((c) => (
          <ContainerRowView
            key={c.id}
            c={decorate(c)}
            host={data.host}
            prefs={prefs}
            containers={data.containers}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      {lists.visibleStacks?.map((stack) => (
        <StackBlockView
          key={stackKey(stack)}
          stack={stack}
          host={data.host}
          prefs={prefs}
          containers={data.containers}
          showStackHide
        />
      ))}
    </>
  );
}

export function DashboardHiddenStacksContent({
  data,
  prefs,
}: {
  data: PagePayload;
  prefs: DashboardPrefsSnapshot;
}) {
  const { lists, showHiddenList } = useContainerLists(data, prefs);

  return (
    <>
      {showHiddenList
        ? lists.hiddenStacks?.map((stack) => (
            <StackBlockView
              key={stackKey(stack)}
              stack={stack}
              host={data.host}
              prefs={prefs}
              containers={data.containers}
              showStackHide
            />
          ))
        : null}
    </>
  );
}

export function DashboardHiddenStacksShell({
  data,
  prefs,
}: {
  data: PagePayload;
  prefs: DashboardPrefsSnapshot;
}) {
  const { showHiddenList } = useContainerLists(data, prefs);
  return (
    <div
      id="hidden-stacks"
      className="hidden-stacks"
      hidden={!showHiddenList}
    >
      <DashboardHiddenStacksContent data={data} prefs={prefs} />
    </div>
  );
}

export function DashboardEmptyContent({
  data,
  prefs,
}: {
  data: PagePayload;
  prefs: DashboardPrefsSnapshot;
}) {
  const { rows, hasVisible, showHiddenList } = useContainerLists(data, prefs);
  const showEmpty = !hasVisible && !showHiddenList;

  if (!showEmpty) return null;

  if (rows.length === 0) return <>Nenhum container.</>;
  if (prefs.view.query.trim()) {
    return <>Nenhum container corresponde a &quot;{prefs.view.query}&quot;.</>;
  }
  return <>Nenhum container.</>;
}

export function DashboardEmptyShell({
  data,
  prefs,
}: {
  data: PagePayload;
  prefs: DashboardPrefsSnapshot;
}) {
  const { hasVisible, showHiddenList } = useContainerLists(data, prefs);
  const showEmpty = !hasVisible && !showHiddenList;
  return (
    <div id="empty" className="empty" hidden={!showEmpty}>
      <DashboardEmptyContent data={data} prefs={prefs} />
    </div>
  );
}

export function DashboardErrorContent({ error }: { error: string | null }) {
  return (
    <div id="error" className="error" hidden={!error}>
      {error ?? ""}
    </div>
  );
}

function filteredRows(containers: PagePayload["containers"], query: string) {
  const q = query.trim().toLowerCase();
  return containers.filter(
    (c) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.image.toLowerCase().includes(q) ||
      c.stack.toLowerCase().includes(q),
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}
function RestartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3.5 2.7 5.5 6 .9-4.4 4.2 1 5.9L12 17.2 6.7 20l1-5.9L3.4 9.9l6-.9z" />
    </svg>
  );
}
function HideIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
function LogsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 6h8M8 10h8M8 14h5" />
      <rect x="4" y="3" width="16" height="18" rx="2" />
    </svg>
  );
}
function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
function ChevronUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}
function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="m21 3-7 7" />
      <path d="M9 21H3v-6" />
      <path d="m3 21 7-7" />
    </svg>
  );
}
