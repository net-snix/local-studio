import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DashboardLayoutProps } from "@/features/dashboard/layout/dashboard-types";
import { buildRuntimeSummary } from "./dashboard-runtime-summary";

const statusData = (overrides: Partial<DashboardLayoutProps> = {}): DashboardLayoutProps => ({
  currentProcess: null,
  currentRecipe: null,
  metrics: null,
  gpus: [],
  recipes: [],
  logs: [],
  launching: false,
  lifecycleStatus: "idle",
  lifecycleError: null,
  benchmarking: false,
  benchmarkResult: null,
  launchProgress: null,
  platformKind: "cuda",
  isConnected: true,
  isStatusLoading: false,
  inferencePort: 8000,
  onNavigateLogs: () => {},
  onBenchmark: () => {},
  onLaunch: async () => {},
  onNewRecipe: () => {},
  onViewAll: () => {},
  ...overrides,
});

describe("dashboard runtime summary", () => {
  test("renders identified external engine metrics without making the runtime controllable", () => {
    const summary = buildRuntimeSummary(
      statusData({
        metrics: {
          model_id: "deepseek-v4-flash-0731",
          served_model_name: "deepseek-v4-flash-0731",
          generation_throughput: 145,
          prompt_throughput: 53_668,
          avg_ttft_ms: 605.9,
        },
      }),
    );

    assert.equal(summary.active, true);
    assert.equal(summary.controllable, false);
    assert.equal(summary.modelName, "deepseek-v4-flash-0731");
    assert.equal(summary.decode, "145.0");
    assert.equal(summary.prefill, "53668.0");
    assert.equal(summary.ttft, "606");
  });

  test("uses stored peaks while an observed engine is idle", () => {
    const summary = buildRuntimeSummary(
      statusData({
        metrics: {
          model_id: "deepseek-v4-flash-0731",
          generation_throughput: 0,
          prompt_throughput: 0,
          peak_generation_tps: 354.9,
          peak_prefill_tps: 73_997.7,
          peak_ttft_ms: 286.5,
        },
      }),
    );

    assert.equal(summary.decode, "354.9");
    assert.equal(summary.prefill, "73997.7");
    assert.equal(summary.ttft, "287");
  });

  test("prefers the recent interval TTFT over the engine-lifetime average", () => {
    const summary = buildRuntimeSummary(
      statusData({
        metrics: {
          model_id: "glm-5.3-flash",
          recent_ttft_ms: 412.4,
          avg_ttft_ms: 605.9,
        },
      }),
    );

    assert.equal(summary.ttft, "412");
  });

  test("labels the stored lowest TTFT as best, not peak", () => {
    const summary = buildRuntimeSummary(
      statusData({
        metrics: {
          model_id: "glm-5.3-flash",
          avg_ttft_ms: 605.9,
          session_peak_ttft_ms: 143.2,
          session_peak_generation_throughput: 151.9,
        },
      }),
    );

    assert.equal(summary.ttftPeak, "best 143 ms");
    assert.equal(summary.decodePeak, "peak 151.9");
  });
});
