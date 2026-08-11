import { describe, expect, it } from "bun:test";
import type { ProcessInfo } from "../../../contracts/observability";
import type { EngineScrape } from "./engine-metrics-scrape";
import {
  counterRatePerSecond,
  cumulativeTtftMs,
  intervalTtftMs,
  metricNamesForBackend,
  observeEngineMetrics,
} from "./engine-metrics-observation";

const scrape = (overrides: Partial<EngineScrape> = {}): EngineScrape => ({
  status: 200,
  metrics: {},
  modelName: null,
  hasVllm: false,
  hasSglang: false,
  hasLlamacpp: false,
  ...overrides,
});

describe("engine metrics observation", () => {
  it("observes an external vLLM endpoint without making it a managed process", () => {
    expect(
      observeEngineMetrics(null, scrape({ hasVllm: true, modelName: "deepseek-v4-flash-0731" })),
    ).toEqual({
      backend: "vllm",
      metricsBackend: "vllm",
      modelId: "deepseek-v4-flash-0731",
      modelPath: null,
      servedModelName: "deepseek-v4-flash-0731",
    });
  });

  it("keeps managed process identity ahead of scraped identity", () => {
    const current: ProcessInfo = {
      pid: 42,
      backend: "sglang",
      model_path: "/models/managed-model",
      port: 8000,
      served_model_name: "managed-model",
    };

    expect(observeEngineMetrics(current, scrape({ hasVllm: true, modelName: "external" }))).toEqual(
      {
        backend: "sglang",
        metricsBackend: "sglang",
        modelId: "managed-model",
        modelPath: "/models/managed-model",
        servedModelName: "managed-model",
      },
    );
  });

  it("returns no observation when neither ownership nor engine metrics exist", () => {
    expect(observeEngineMetrics(null, scrape())).toBeNull();
  });

  it("keeps cumulative TTFT visible between completed requests", () => {
    const names = metricNamesForBackend("vllm");
    const previous = {
      [names.ttftSum]: 1.2,
      [names.ttftCount]: 2,
    };
    const current = {
      [names.ttftSum]: 1.2,
      [names.ttftCount]: 2,
    };

    expect(cumulativeTtftMs(current, names)).toBe(600);
    expect(intervalTtftMs(current, {}, names)).toBe(0);
    expect(intervalTtftMs(current, previous, names)).toBe(0);
  });

  it("derives throughput from increasing engine counters", () => {
    expect(counterRatePerSecond(1500, 1000, 5)).toBe(100);
    expect(counterRatePerSecond(900, 1000, 5)).toBe(0);
  });
});
