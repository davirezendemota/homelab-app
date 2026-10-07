import {
  CACHE_FAST_INTERVAL_MS,
  CACHE_STORAGE_INTERVAL_MS,
  MODULE_BUILD,
} from "./config";
import {
  attachCpuPct,
  attachMemPct,
  containerCpuPct,
  containerMemPctOfHost,
  containerName,
  runningContainers,
  runningContainerStats,
  type ContainerRow,
} from "./docker";
import {
  buildMeters,
  ramStats,
  temperatureSensorDetails,
} from "./host-metrics";
import { meterDetailPayload, refreshMeterDetailCpuRam } from "./meter-details";
import {
  getContainerStartHistory,
  observeContainers,
  refreshContainerStartedAt,
  type ContainerLifecycleEvent,
} from "./container-start-history";

export type PagePayload = {
  host: string;
  build: string;
  loaded_build: string;
  error: string | null;
  containers: ContainerRow[];
  meters: Record<string, unknown>[];
  containerHistory: ContainerLifecycleEvent[];
};

class MetricsCache {
  private containers: ContainerRow[] = [];
  private meters: Record<string, unknown>[] = [];
  private statusError: string | null = null;
  private meterDetails: Record<string, Record<string, unknown>> = {};
  private lastStorageRefresh = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;

  async warm(): Promise<void> {
    await this.refreshFast();
    await refreshContainerStartedAt(this.containers);
    await this.refreshStorage();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refreshFast().then(() => {
        if (Date.now() - this.lastStorageRefresh >= CACHE_STORAGE_INTERVAL_MS) {
          void this.refreshStorage();
        }
      });
    }, CACHE_FAST_INTERVAL_MS);
  }

  private async refreshFast(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      let containers: ContainerRow[] | null = null;
      let meters: Record<string, unknown>[] | null = null;
      let statusError: string | null = null;
      const meterUpdates: Record<string, Record<string, unknown>> = {};
      let cpuByName: Record<string, number> = {};
      let memByName: Record<string, number> = {};

      try {
        const pairs = await runningContainerStats();
        const refreshed = await refreshMeterDetailCpuRam(pairs);
        meterUpdates.cpu = refreshed.cpu;
        meterUpdates.ram = refreshed.ram;
        const [, , ramTotalGb] = ramStats();
        const ramTotalBytes = Math.floor(ramTotalGb * 1024 ** 3);
        cpuByName = Object.fromEntries(
          pairs.map(({ container, stats }) => [
            containerName(container),
            containerCpuPct(stats),
          ]),
        );
        memByName = Object.fromEntries(
          pairs.map(({ container, stats }) => [
            containerName(container),
            containerMemPctOfHost(stats, ramTotalBytes),
          ]),
        );
      } catch (exc) {
        const msg = exc instanceof Error ? exc.message : String(exc);
        meterUpdates.cpu = { error: msg };
        meterUpdates.ram = { error: msg };
      }

      try {
        containers = await runningContainers();
        attachCpuPct(containers, cpuByName);
        attachMemPct(containers, memByName);
      } catch (exc) {
        statusError = exc instanceof Error ? exc.message : String(exc);
      }

      try {
        meters = await buildMeters();
      } catch (exc) {
        if (statusError == null) {
          statusError = exc instanceof Error ? exc.message : String(exc);
        }
      }

      try {
        meterUpdates.temp = {
          rows: temperatureSensorDetails(),
          total: 100,
        };
      } catch (exc) {
        meterUpdates.temp = {
          error: exc instanceof Error ? exc.message : String(exc),
        };
      }

      if (containers != null) {
        observeContainers(containers);
        this.containers = containers;
      }
      if (meters != null) this.meters = meters;
      if (statusError != null) {
        this.statusError = statusError;
      } else if (containers != null) {
        this.statusError = null;
      }
      for (const [kind, data] of Object.entries(meterUpdates)) {
        if (!("error" in data) || !(kind in this.meterDetails)) {
          this.meterDetails[kind] = data;
        }
      }
    } finally {
      this.refreshing = false;
    }
  }

  private async refreshStorage(): Promise<void> {
    try {
      await refreshContainerStartedAt(this.containers);
    } catch {
      /* ignore */
    }
    try {
      const data = await meterDetailPayload("storage");
      const { kind: _k, ...rest } = data;
      this.meterDetails.storage = rest;
      this.lastStorageRefresh = Date.now();
    } catch (exc) {
      if (!this.meterDetails.storage) {
        this.meterDetails.storage = {
          error: exc instanceof Error ? exc.message : String(exc),
        };
      }
    }
  }

  pagePayload(host: string): PagePayload {
    return {
      host,
      build: MODULE_BUILD,
      loaded_build: MODULE_BUILD,
      error: this.statusError,
      containers: structuredClone(this.containers),
      meters: structuredClone(this.meters),
      containerHistory: getContainerStartHistory(),
    };
  }

  meterDetail(kind: string): Record<string, unknown> {
    const data = this.meterDetails[kind];
    if (!data) {
      return { kind, error: "Dados ainda não disponíveis" };
    }
    return { ...structuredClone(data), kind };
  }
}

let cache: MetricsCache | null = null;

function getCache(): MetricsCache {
  if (!cache) {
    cache = new MetricsCache();
  }
  return cache;
}

let bootPromise: Promise<void> | null = null;

function bootCache(): Promise<void> {
  if (!bootPromise) {
    bootPromise = startMetricsCache();
  }
  return bootPromise;
}

export async function getPagePayload(host: string): Promise<PagePayload> {
  await bootCache();
  return getCache().pagePayload(host);
}

export async function getMeterDetail(
  kind: string,
): Promise<Record<string, unknown>> {
  await bootCache();
  return getCache().meterDetail(kind);
}

export async function startMetricsCache(): Promise<void> {
  const c = getCache();
  await c.warm();
  c.start();
}
