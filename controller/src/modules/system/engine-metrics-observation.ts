import type { ProcessInfo } from "../../../contracts/observability";
import {
  LLAMACPP_METRIC_NAMES,
  SGLANG_METRIC_NAMES,
  VLLM_METRIC_NAMES,
  type EngineMetricNames,
  type EngineScrape,
} from "./engine-metrics-scrape";

export type EngineMetricsBackend = "vllm" | "sglang" | "llamacpp";

export type EngineMetricsObservation = {
  backend: string;
  metricsBackend: EngineMetricsBackend | null;
  modelId: string;
  modelPath: string | null;
  servedModelName: string | null;
};

const supportedBackend = (value: string | null | undefined): EngineMetricsBackend | null => {
  if (value === "vllm" || value === "sglang" || value === "llamacpp") return value;
  return null;
};

const scrapedBackend = (scrape: EngineScrape): EngineMetricsBackend | null => {
  if (scrape.hasSglang) return "sglang";
  if (scrape.hasLlamacpp) return "llamacpp";
  if (scrape.hasVllm) return "vllm";
  return null;
};

export const observeEngineMetrics = (
  current: ProcessInfo | null,
  scrape: EngineScrape,
): EngineMetricsObservation | null => {
  const metricsBackend = supportedBackend(current?.backend) ?? scrapedBackend(scrape);
  if (!current && !metricsBackend) return null;
  const modelId =
    current?.served_model_name ??
    current?.model_path?.split("/").pop() ??
    scrape.modelName ??
    "active";
  return {
    backend: current?.backend ?? metricsBackend ?? "unknown",
    metricsBackend,
    modelId,
    modelPath: current?.model_path ?? null,
    servedModelName: current?.served_model_name ?? scrape.modelName ?? null,
  };
};

export const metricNamesForBackend = (backend: EngineMetricsBackend): EngineMetricNames => {
  if (backend === "sglang") return SGLANG_METRIC_NAMES;
  if (backend === "llamacpp") return LLAMACPP_METRIC_NAMES;
  return VLLM_METRIC_NAMES;
};

export const cumulativeTtftMs = (
  metrics: Record<string, number>,
  names: EngineMetricNames,
): number => {
  const count = metrics[names.ttftCount] ?? 0;
  if (count <= 0) return 0;
  return ((metrics[names.ttftSum] ?? 0) / count) * 1000;
};

export const counterRatePerSecond = (
  current: number,
  previous: number,
  elapsedSeconds: number,
): number => {
  if (elapsedSeconds <= 0 || current <= previous) return 0;
  return (current - previous) / elapsedSeconds;
};

export const intervalTtftMs = (
  metrics: Record<string, number>,
  previous: Record<string, number>,
  names: EngineMetricNames,
): number => {
  if (!(names.ttftCount in previous)) return 0;
  const count = metrics[names.ttftCount] ?? 0;
  const previousCount = previous[names.ttftCount] ?? 0;
  const countDelta = count - previousCount;
  if (countDelta <= 0) return 0;
  const sum = metrics[names.ttftSum] ?? 0;
  const previousSum = previous[names.ttftSum] ?? 0;
  return ((sum - previousSum) / countDelta) * 1000;
};
