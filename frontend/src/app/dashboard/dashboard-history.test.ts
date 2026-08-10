import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { LinuxDashboardSnapshot } from "@/lib/types";
import {
  appendDashboardHistory,
  getGpuMemoryUsageSamples,
  getCpuUsageSamples,
  getGpuUsageSeries,
  getSystemPowerSamples,
  loadStoredDashboardHistory,
  storeDashboardHistory,
} from "./dashboard-history";

const makeSnapshot = (
  collectedAt: string,
  cpuUsage: number,
  gpuUsage: number[],
): LinuxDashboardSnapshot => ({
  collected_at: collectedAt,
  host: {
    hostname: "test-host",
    platform: "linux",
    kernel: "test",
    arch: "x64",
    uptime_seconds: 100,
    load_average: [0.1, 0.2, 0.3],
    cpu_cores: 8,
    cpu_model: "Test CPU",
    cpu_physical_cores: 4,
    cpu_threads: 8,
    target: "controller-host",
  },
  cpu: {
    usage_percent: cpuUsage,
    cores: 8,
    load_percent_1m: cpuUsage,
    power_draw_watts: 42,
  },
  memory: {
    total_bytes: 100,
    available_bytes: 50,
    used_bytes: 50,
    used_percent: 50,
    swap_total_bytes: 0,
    swap_used_bytes: 0,
  },
  gpus: gpuUsage.map((usage, index) => ({
    index,
    name: `GPU ${index}`,
    uuid: `GPU-${index}`,
    pci_bus_id: null,
    utilization_percent: usage,
    memory_total_bytes: index === 0 ? 100 : 300,
    memory_used_bytes: index === 0 ? 50 : 30,
    memory_used_percent: index === 0 ? 50 : 10,
    temperature_c: 40,
    memory_temperature_c: 45,
    memory_temperature_unavailable_reason: null,
    fan_percent: 20,
    power_draw_watts: 100 + index,
    power_limit_watts: 300,
    status: "ok",
  })),
  disks: [],
  fans: [],
  thermals: [],
  services: [],
  containers: [],
  docker_error: null,
  alerts: [],
});

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

function restoreWindow(): void {
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
    return;
  }
  Reflect.deleteProperty(globalThis, "window");
}

const stubStorage = (): Map<string, string> => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string): string | null => values.get(key) ?? null,
        setItem: (key: string, value: string): void => {
          values.set(key, value);
        },
      },
    },
  });
  return values;
};

afterEach(restoreWindow);

test("dashboard history deduplicates snapshots and keeps the newest samples inside the limit", () => {
  const history = [
    makeSnapshot("2026-04-29T10:00:00.000Z", 10, [20]),
    makeSnapshot("2026-04-29T10:00:05.000Z", 15, [25]),
    makeSnapshot("2026-04-29T10:00:10.000Z", 20, [30]),
  ].reduce(
    (acc, snapshot) => appendDashboardHistory(acc, snapshot, 2),
    [] as ReturnType<typeof appendDashboardHistory>,
  );

  assert.deepEqual(
    history.map((point) => point.collected_at),
    ["2026-04-29T10:00:05.000Z", "2026-04-29T10:00:10.000Z"],
  );

  const deduped = appendDashboardHistory(
    history,
    makeSnapshot("2026-04-29T10:00:10.000Z", 99, [99]),
    2,
  );
  assert.equal(deduped, history);
});

test("dashboard history keeps only the newest five minutes of dashboard history", () => {
  const history = [
    makeSnapshot("2026-04-29T10:00:00.000Z", 10, [20]),
    makeSnapshot("2026-04-29T10:04:59.000Z", 15, [25]),
    makeSnapshot("2026-04-29T10:05:01.000Z", 20, [30]),
  ].reduce(
    (acc, snapshot) => appendDashboardHistory(acc, snapshot),
    [] as ReturnType<typeof appendDashboardHistory>,
  );

  assert.deepEqual(
    history.map((point) => point.collected_at),
    ["2026-04-29T10:04:59.000Z", "2026-04-29T10:05:01.000Z"],
  );
});

test("dashboard history returns a separate utilization series for each GPU", () => {
  const history = [
    makeSnapshot("2026-04-29T10:00:00.000Z", 10, [20, 80]),
    makeSnapshot("2026-04-29T10:00:05.000Z", 10, [25, 70]),
  ].reduce(
    (acc, snapshot) => appendDashboardHistory(acc, snapshot),
    [] as ReturnType<typeof appendDashboardHistory>,
  );

  assert.deepEqual(
    getGpuUsageSeries(history, { index: 0, name: "GPU 0", uuid: "GPU-0" }),
    [20, 25],
  );
  assert.deepEqual(
    getGpuUsageSeries(history, { index: 1, name: "GPU 1", uuid: "GPU-1" }),
    [80, 70],
  );
});

test("dashboard history returns timestamped CPU samples for time-window charts", () => {
  const history = [
    makeSnapshot("2026-04-29T10:00:00.000Z", 10, [20]),
    makeSnapshot("2026-04-29T10:00:05.000Z", 15, [25]),
  ].reduce(
    (acc, snapshot) => appendDashboardHistory(acc, snapshot),
    [] as ReturnType<typeof appendDashboardHistory>,
  );

  assert.deepEqual(getCpuUsageSamples(history), [
    { time: Date.parse("2026-04-29T10:00:00.000Z"), value: 10 },
    { time: Date.parse("2026-04-29T10:00:05.000Z"), value: 15 },
  ]);
});

test("dashboard history returns weighted total VRAM samples across mixed-size GPUs", () => {
  const history = [
    makeSnapshot("2026-04-29T10:00:00.000Z", 10, [20, 80]),
    makeSnapshot("2026-04-29T10:00:05.000Z", 15, [25]),
  ].reduce(
    (acc, snapshot) => appendDashboardHistory(acc, snapshot),
    [] as ReturnType<typeof appendDashboardHistory>,
  );

  assert.deepEqual(getGpuMemoryUsageSamples(history), [
    { time: Date.parse("2026-04-29T10:00:00.000Z"), value: 20 },
    { time: Date.parse("2026-04-29T10:00:05.000Z"), value: 50 },
  ]);
});

test("dashboard history returns system power samples from CPU and all GPUs", () => {
  const history = [
    makeSnapshot("2026-04-29T10:00:00.000Z", 10, [20, 80]),
    makeSnapshot("2026-04-29T10:00:05.000Z", 15, []),
  ].reduce(
    (acc, snapshot) => appendDashboardHistory(acc, snapshot),
    [] as ReturnType<typeof appendDashboardHistory>,
  );

  assert.deepEqual(getSystemPowerSamples(history), [
    { time: Date.parse("2026-04-29T10:00:00.000Z"), value: 243 },
    { time: Date.parse("2026-04-29T10:00:05.000Z"), value: 42 },
  ]);
});

test("dashboard history persists and restores valid browser history", () => {
  stubStorage();
  const history = [
    makeSnapshot("2026-04-29T10:00:00.000Z", 10, [20]),
    makeSnapshot("2026-04-29T10:00:05.000Z", 15, [25]),
  ].reduce(
    (acc, snapshot) => appendDashboardHistory(acc, snapshot),
    [] as ReturnType<typeof appendDashboardHistory>,
  );

  storeDashboardHistory(history);

  assert.deepEqual(loadStoredDashboardHistory(), history);
});

test("dashboard history ignores invalid stored history", () => {
  const storage = stubStorage();
  storage.set("vllm-studio-dashboard-history", JSON.stringify([{ time: "bad" }]));

  assert.deepEqual(loadStoredDashboardHistory(), []);
});
