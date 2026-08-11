import type { LinuxDashboardGpu, LinuxDashboardSnapshot } from "@/lib/types";

export type DashboardHistoryGpu = {
  key: string;
  index: number;
  name: string;
  utilization_percent: number | null;
  memory_total_bytes: number;
  memory_used_bytes: number;
  memory_used_percent: number | null;
  temperature_c: number | null;
  power_draw_watts: number | null;
};

export type DashboardHistoryPoint = {
  collected_at: string;
  time: number;
  break_before?: boolean;
  cpu_usage_percent: number | null;
  cpu_load_percent: number | null;
  cpu_power_draw_watts: number | null;
  memory_used_percent: number;
  gpus: DashboardHistoryGpu[];
};

const DASHBOARD_HISTORY_WINDOW_MS = 5 * 60 * 1000;
const DASHBOARD_SAMPLE_INTERVAL_MS = 1000;
const DASHBOARD_GAP_THRESHOLD_MS = 3000;
const DEFAULT_HISTORY_LIMIT = 900;
const DASHBOARD_HISTORY_STORAGE_KEY = "vllm-studio-dashboard-history";

export type DashboardUsageSample = {
  time: number;
  value: number | null;
  break_before?: boolean;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isNullableFiniteNumber = (value: unknown): value is number | null =>
  value === null || isFiniteNumber(value);

const isHistoryGpu = (value: unknown): value is DashboardHistoryGpu => {
  if (!value || typeof value !== "object") return false;
  const gpu = value as Partial<DashboardHistoryGpu>;
  return (
    typeof gpu.key === "string" &&
    isFiniteNumber(gpu.index) &&
    typeof gpu.name === "string" &&
    isNullableFiniteNumber(gpu.utilization_percent) &&
    isFiniteNumber(gpu.memory_total_bytes) &&
    isFiniteNumber(gpu.memory_used_bytes) &&
    isNullableFiniteNumber(gpu.memory_used_percent) &&
    isNullableFiniteNumber(gpu.temperature_c) &&
    isNullableFiniteNumber(gpu.power_draw_watts)
  );
};

const isHistoryPoint = (value: unknown): value is DashboardHistoryPoint => {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<DashboardHistoryPoint>;
  return (
    typeof point.collected_at === "string" &&
    Number.isFinite(Date.parse(point.collected_at)) &&
    isFiniteNumber(point.time) &&
    (point.break_before === undefined || typeof point.break_before === "boolean") &&
    isNullableFiniteNumber(point.cpu_usage_percent) &&
    isNullableFiniteNumber(point.cpu_load_percent) &&
    isNullableFiniteNumber(point.cpu_power_draw_watts) &&
    isFiniteNumber(point.memory_used_percent) &&
    Array.isArray(point.gpus) &&
    point.gpus.every(isHistoryGpu)
  );
};

export const dashboardGpuKey = (gpu: Pick<LinuxDashboardGpu, "index" | "name" | "uuid">): string =>
  gpu.uuid ?? `${gpu.index}:${gpu.name}`;

const finiteOrNull = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const snapshotToHistoryPoint = (
  snapshot: LinuxDashboardSnapshot,
  time = Date.parse(snapshot.collected_at),
  breakBefore = false,
): DashboardHistoryPoint => ({
  collected_at: snapshot.collected_at,
  time,
  ...(breakBefore ? { break_before: true } : {}),
  cpu_usage_percent: finiteOrNull(snapshot.cpu.usage_percent),
  cpu_load_percent: finiteOrNull(snapshot.cpu.load_percent_1m),
  cpu_power_draw_watts: finiteOrNull(snapshot.cpu.power_draw_watts),
  memory_used_percent: snapshot.memory.used_percent,
  gpus: snapshot.gpus.map((gpu) => ({
    key: dashboardGpuKey(gpu),
    index: gpu.index,
    name: gpu.name,
    utilization_percent: finiteOrNull(gpu.utilization_percent),
    memory_total_bytes: gpu.memory_total_bytes,
    memory_used_bytes: gpu.memory_used_bytes,
    memory_used_percent: finiteOrNull(gpu.memory_used_percent),
    temperature_c: finiteOrNull(gpu.temperature_c),
    power_draw_watts: finiteOrNull(gpu.power_draw_watts),
  })),
});

export const appendDashboardHistory = (
  history: DashboardHistoryPoint[],
  snapshot: LinuxDashboardSnapshot,
  limit = DEFAULT_HISTORY_LIMIT,
): DashboardHistoryPoint[] => {
  const last = history.at(-1);
  const collectedAt = Date.parse(snapshot.collected_at);
  const lastCollectedAt = last ? Date.parse(last.collected_at) : null;
  if (!Number.isFinite(collectedAt)) return history;
  if (lastCollectedAt !== null && collectedAt <= lastCollectedAt) return history;

  const elapsed = lastCollectedAt === null ? 0 : collectedAt - lastCollectedAt;
  const breakBefore = last !== undefined && elapsed > DASHBOARD_GAP_THRESHOLD_MS;
  const time = last
    ? last.time + (breakBefore ? DASHBOARD_SAMPLE_INTERVAL_MS : Math.max(elapsed, 1))
    : collectedAt;
  const next = snapshotToHistoryPoint(snapshot, time, breakBefore);
  const earliest = next.time - DASHBOARD_HISTORY_WINDOW_MS;
  return [...history, next].filter((point) => point.time >= earliest).slice(-limit);
};

export const loadStoredDashboardHistory = (): DashboardHistoryPoint[] => {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(DASHBOARD_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const history = parsed.filter(isHistoryPoint).slice(-DEFAULT_HISTORY_LIMIT);
    const latest = history.at(-1);
    if (!latest) return [];
    const earliest = latest.time - DASHBOARD_HISTORY_WINDOW_MS;
    return history.filter((point) => point.time >= earliest);
  } catch {
    return [];
  }
};

export const storeDashboardHistory = (history: DashboardHistoryPoint[]): void => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      DASHBOARD_HISTORY_STORAGE_KEY,
      JSON.stringify(history.slice(-DEFAULT_HISTORY_LIMIT)),
    );
  } catch {}
};

const getCpuUsageSeries = (history: DashboardHistoryPoint[]): Array<number | null> =>
  history.map((point) => point.cpu_usage_percent ?? point.cpu_load_percent);

export const getCpuUsageSamples = (history: DashboardHistoryPoint[]): DashboardUsageSample[] =>
  history.map((point) => ({
    time: point.time,
    value: point.cpu_usage_percent ?? point.cpu_load_percent,
    ...(point.break_before ? { break_before: true } : {}),
  }));

export const getMemoryUsageSamples = (history: DashboardHistoryPoint[]): DashboardUsageSample[] =>
  history.map((point) => ({
    time: point.time,
    value: point.memory_used_percent,
    ...(point.break_before ? { break_before: true } : {}),
  }));

export const getGpuUsageSeries = (
  history: DashboardHistoryPoint[],
  gpu: Pick<LinuxDashboardGpu, "index" | "name" | "uuid">,
): Array<number | null> => {
  const key = dashboardGpuKey(gpu);
  return history.map((point) => {
    const sample =
      point.gpus.find((entry) => entry.key === key) ??
      point.gpus.find((entry) => entry.index === gpu.index);
    return sample?.utilization_percent ?? null;
  });
};

export const getGpuUsageSamples = (
  history: DashboardHistoryPoint[],
  gpu: Pick<LinuxDashboardGpu, "index" | "name" | "uuid">,
): DashboardUsageSample[] => {
  const key = dashboardGpuKey(gpu);
  return history.map((point) => {
    const sample =
      point.gpus.find((entry) => entry.key === key) ??
      point.gpus.find((entry) => entry.index === gpu.index);
    return {
      time: point.time,
      value: sample?.utilization_percent ?? null,
      ...(point.break_before ? { break_before: true } : {}),
    };
  });
};

export const getGpuMemoryUsageSamples = (
  history: DashboardHistoryPoint[],
): DashboardUsageSample[] =>
  history.map((point) => {
    const totalBytes = point.gpus.reduce((sum, gpu) => sum + gpu.memory_total_bytes, 0);
    const usedBytes = point.gpus.reduce((sum, gpu) => sum + gpu.memory_used_bytes, 0);
    return {
      time: point.time,
      value: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : null,
      ...(point.break_before ? { break_before: true } : {}),
    };
  });

export const getSystemPowerSamples = (history: DashboardHistoryPoint[]): DashboardUsageSample[] =>
  history.map((point) => {
    const gpuPower = point.gpus.reduce(
      (sum, gpu) =>
        typeof gpu.power_draw_watts === "number" && Number.isFinite(gpu.power_draw_watts)
          ? sum + gpu.power_draw_watts
          : sum,
      0,
    );
    const cpuPower =
      typeof point.cpu_power_draw_watts === "number" && Number.isFinite(point.cpu_power_draw_watts)
        ? point.cpu_power_draw_watts
        : 0;
    const totalPower = gpuPower + cpuPower;
    return {
      time: point.time,
      value: totalPower > 0 ? totalPower : null,
      ...(point.break_before ? { break_before: true } : {}),
    };
  });
