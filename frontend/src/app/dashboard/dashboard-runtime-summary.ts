import type { DashboardLayoutProps } from "@/features/dashboard/layout/dashboard-types";
import type { GPU } from "@/lib/types";
import { toGB, toGBFromMB } from "@/lib/formatters";

export function buildRuntimeSummary(statusData: DashboardLayoutProps) {
  const metrics = statusData.metrics;
  const currentProcess = statusData.currentProcess;
  const currentRecipe = statusData.currentRecipe;
  const running = Boolean(currentProcess);
  const modelName =
    currentRecipe?.name ||
    currentProcess?.served_model_name ||
    currentProcess?.model_path?.split("/").pop() ||
    "No model loaded";

  const fallbackPower = sumPositive(statusData.gpus.map((gpu) => gpu.power_draw));
  const fallbackPowerLimit = sumPositive(statusData.gpus.map((gpu) => gpu.power_limit));
  const fallbackVramUsed = sumPositive(statusData.gpus.map(gpuUsedGb));
  const fallbackVramTotal = sumPositive(statusData.gpus.map(gpuTotalGb));

  const decode = firstPositive(
    metrics?.generation_throughput,
    metrics?.session_avg_generation,
    metrics?.session_peak_generation_throughput,
    metrics?.session_peak_generation,
    metrics?.peak_generation_tps,
  );
  const prefill = firstPositive(
    metrics?.prompt_throughput,
    metrics?.session_avg_prefill,
    metrics?.session_peak_prompt_throughput,
    metrics?.session_peak_prefill,
    metrics?.peak_prefill_tps,
  );
  const ttft = firstPositive(
    metrics?.avg_ttft_ms,
    metrics?.session_peak_ttft_ms,
    metrics?.peak_ttft_ms,
  );
  const decodePeak = firstPositive(
    metrics?.session_peak_generation_throughput,
    metrics?.session_peak_generation,
    metrics?.peak_generation_tps,
  );
  const prefillPeak = firstPositive(
    metrics?.session_peak_prompt_throughput,
    metrics?.session_peak_prefill,
    metrics?.peak_prefill_tps,
  );
  const ttftPeak = firstPositive(metrics?.session_peak_ttft_ms, metrics?.peak_ttft_ms);
  const totalPower = firstPositive(metrics?.current_power_watts, fallbackPower);
  const powerLimit = firstPositive(metrics?.power_limit_watts, fallbackPowerLimit);
  const vramUsed = firstPositive(metrics?.vram_used_gb, fallbackVramUsed);
  const vramTotal = firstPositive(metrics?.vram_capacity_gb, fallbackVramTotal);
  const runningRequests = normalizeCount(metrics?.running_requests);
  const peakRequests = normalizeCount(metrics?.session_peak_running_requests) || runningRequests;

  return {
    running,
    modelName,
    backend: currentProcess?.backend ?? currentRecipe?.backend ?? null,
    platform: statusData.platformKind,
    port: statusData.inferencePort || currentProcess?.port || null,
    decode: formatNumberMetric(decode, 1),
    ttft: formatNumberMetric(ttft, 0),
    prefill: formatNumberMetric(prefill, 1),
    decodePeak: formatPeak(decodePeak, 1),
    ttftPeak: formatPeak(ttftPeak, 0, " ms"),
    prefillPeak: formatPeak(prefillPeak, 1),
    requests: `${runningRequests}/${peakRequests}`,
    vram: formatRatio(vramUsed, vramTotal, "G", 1),
    power: formatRatio(totalPower, powerLimit, "W", 0),
    totalTokens: tokenTotalMetric(metrics),
    promptTokens: tokenMetric(metrics?.prompt_tokens_total),
    completionTokens: tokenMetric(metrics?.generation_tokens_total),
    duration: durationMetric(metrics?.latency_avg),
  };
}

function firstPositive(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function normalizeCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function formatNumberMetric(value: number | null, digits: number): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value.toFixed(digits)
    : null;
}

function formatPeak(value: number | null, digits: number, suffix = ""): string | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `peak ${value.toFixed(digits)}${suffix}`
    : undefined;
}

function formatRatio(
  value: number | null,
  total: number | null,
  unit: string,
  valueDigits: number,
): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return null;
  return `${value.toFixed(valueDigits)}/${total.toFixed(0)}${unit}`;
}

function tokenMetric(...values: Array<number | undefined>): string {
  const value = values.find(
    (item) => typeof item === "number" && Number.isFinite(item) && item >= 0,
  );
  return typeof value === "number" ? Math.round(value).toLocaleString() : "unavailable";
}

function tokenTotalMetric(metrics: DashboardLayoutProps["metrics"]): string {
  const explicit = tokenMetric(metrics?.total_tokens, metrics?.tokens_total);
  if (explicit !== "unavailable") return explicit;
  if (
    typeof metrics?.prompt_tokens_total === "number" &&
    typeof metrics.generation_tokens_total === "number"
  ) {
    return tokenMetric(metrics.prompt_tokens_total + metrics.generation_tokens_total);
  }
  return "unavailable";
}

function durationMetric(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "unavailable";
  return value > 1000 ? `${(value / 1000).toFixed(2)}s` : `${value.toFixed(0)}ms`;
}

function gpuUsedGb(gpu: GPU): number {
  return toGBFromMB(gpu.memory_used_mb);
}

function gpuTotalGb(gpu: GPU): number {
  return toGBFromMB(gpu.memory_total_mb);
}

function sumPositive(values: Array<number | null | undefined>): number | null {
  const total = values.reduce<number>(
    (sum, value) =>
      typeof value === "number" && Number.isFinite(value) && value > 0 ? sum + value : sum,
    0,
  );
  return total > 0 ? total : null;
}
