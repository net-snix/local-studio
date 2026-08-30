import type { AppContext } from "../../app-context";
import { Effect, Schedule } from "effect";
import { getGpuInfo } from "./platform/gpu";
import { getSystemRuntimeInfo } from "../engines/runtimes/runtime-info";
import type { UsageAggregate } from "../../stores/inference-request-store";
import { scrapeEngineMetrics } from "./engine-metrics-scrape";
import {
  counterRatePerSecond,
  cumulativeTtftMs,
  intervalTtftMs,
  metricNamesForBackend,
  observeEngineMetrics,
} from "./engine-metrics-observation";
import {
  bumpBestLower,
  bumpPeak,
  emptyPeaks,
  firstMetric,
  positiveOrUndefined,
  type SessionPeaks,
} from "./metrics-peaks";

const METRICS_HTTP_TIMEOUT_MS = 5_000;
const METRICS_RUNTIME_SUMMARY_INTERVAL_MS = 30_000;
const METRICS_COLLECT_INTERVAL_MS = 5_000;
const METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS = 5;

export const startMetricsCollector = (context: AppContext): Effect.Effect<never> => {
  let lastEngineMetrics: Record<string, number> = {};
  let lastMetricsTime = 0;
  let lastRuntimeSummaryAt = 0;
  let sessionModelId: string | null = null;
  let sessionPeakId: string | null = null;
  let sessionPeaks: SessionPeaks = emptyPeaks();
  let recentTtftMs = 0;

  const collect = Effect.gen(function* () {
    const current = yield* context.bridge.findInferenceProcess();
    const gpuList = yield* getGpuInfo();

    const lifetimeStore = context.stores.lifetimeMetricsStore;
    const totalPowerWatts = gpuList.reduce((sum, gpu) => sum + gpu.power_draw, 0);
    const energyWh = totalPowerWatts * (5 / 3600);
    yield* lifetimeStore.incrementEffect("energy_wh", energyWh);
    yield* lifetimeStore.incrementEffect(
      "uptime_seconds",
      METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS,
    );

    yield* context.eventManager.publishStatus({
      running: Boolean(current),
      process: current,
      inference_port: context.config.inference_port,
      launching: context.bridge.launchingRecipeId(),
    });
    yield* context.eventManager.publishGpu(gpuList.map((gpu) => ({ ...gpu })));

    if (Date.now() - lastRuntimeSummaryAt > METRICS_RUNTIME_SUMMARY_INTERVAL_MS) {
      yield* getSystemRuntimeInfo(context.config).pipe(
        Effect.flatMap((runtime) => {
          const leaseHolder = current
            ? (current.served_model_name ?? current.model_path?.split("/").pop() ?? "inference")
            : null;
          return context.eventManager
            .publishRuntimeSummary({
              platform: runtime.platform,
              gpu_monitoring: runtime.gpu_monitoring,
              backends: runtime.backends,
              lease: { holder: leaseHolder, since: leaseHolder ? new Date().toISOString() : null },
            })
            .pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  lastRuntimeSummaryAt = Date.now();
                }),
              ),
            );
        }),
        Effect.catch((error) =>
          Effect.sync(() => {
            context.logger.debug("Runtime summary publish failed", { error: String(error) });
          }),
        ),
      );
    }

    const lifetimeData = yield* lifetimeStore.getAllEffect();
    const baseMetrics = {
      lifetime_prompt_tokens: lifetimeData["prompt_tokens_total"] ?? 0,
      lifetime_completion_tokens: lifetimeData["completion_tokens_total"] ?? 0,
      lifetime_requests: lifetimeData["requests_total"] ?? 0,
      lifetime_energy_kwh: (lifetimeData["energy_wh"] ?? 0) / 1000,
      lifetime_uptime_hours: (lifetimeData["uptime_seconds"] ?? 0) / 3600,
      current_power_watts: totalPowerWatts,
      kwh_per_million_input: lifetimeData["prompt_tokens_total"]
        ? (lifetimeData["energy_wh"] ?? 0) /
          1000 /
          ((lifetimeData["prompt_tokens_total"] ?? 1) / 1_000_000)
        : null,
      kwh_per_million_output: lifetimeData["completion_tokens_total"]
        ? (lifetimeData["energy_wh"] ?? 0) /
          1000 /
          ((lifetimeData["completion_tokens_total"] ?? 1) / 1_000_000)
        : null,
    };

    const totalVramUsedGb = gpuList.reduce((sum, gpu) => sum + gpu.memory_used_mb / 1024, 0);
    const totalVramCapacityGb = gpuList.reduce((sum, gpu) => sum + gpu.memory_total_mb / 1024, 0);
    const totalPowerLimitWatts = gpuList.reduce((sum, gpu) => sum + gpu.power_limit, 0);
    const engineScrape = yield* scrapeEngineMetrics(
      context.config.inference_port,
      METRICS_HTTP_TIMEOUT_MS,
    );
    const observation = observeEngineMetrics(current, engineScrape);

    if (observation) {
      const modelId = observation.modelId;
      const sessionModelKey = `${observation.backend}:${modelId}`;

      if (sessionModelId !== sessionModelKey) {
        sessionModelId = sessionModelKey;
        sessionPeakId = `${modelId}:${Date.now()}`;
        sessionPeaks = emptyPeaks();
        lastEngineMetrics = {};
        lastMetricsTime = 0;
        recentTtftMs = 0;
      }

      let promptThroughput = 0;
      let generationThroughput = 0;
      let runningRequests = 0;
      let pendingRequests = 0;
      let kvCacheUsage = 0;
      let promptTokensTotal = 0;
      let generationTokensTotal = 0;
      let avgTtftMs = 0;
      let intervalTtft = 0;

      if (observation.metricsBackend) {
        const engineMetrics = engineScrape.metrics;
        const now = Date.now() / 1000;
        const elapsed =
          lastMetricsTime > 0 ? now - lastMetricsTime : METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS;
        const names = metricNamesForBackend(observation.metricsBackend);
        const hasCounterWindow =
          elapsed > 0 &&
          Object.keys(engineMetrics).length > 0 &&
          Object.keys(lastEngineMetrics).length > 0;
        if (hasCounterWindow) {
          // Counter deltas over the collect window are the live rate. Engine throughput
          // gauges are only a first-tick fallback: SGLang's freeze at their last value
          // while idle, which reads as phantom decode on the dashboard.
          const previousPromptTokens = firstMetric(lastEngineMetrics, names.promptTokens);
          const currentPromptTokens = firstMetric(engineMetrics, names.promptTokens);
          const previousGenerationTokens = firstMetric(lastEngineMetrics, names.generationTokens);
          const currentGenerationTokens = firstMetric(engineMetrics, names.generationTokens);
          promptThroughput = counterRatePerSecond(
            currentPromptTokens,
            previousPromptTokens,
            elapsed,
          );
          generationThroughput = counterRatePerSecond(
            currentGenerationTokens,
            previousGenerationTokens,
            elapsed,
          );
        } else {
          promptThroughput = firstMetric(engineMetrics, names.promptThroughput);
          generationThroughput = firstMetric(engineMetrics, names.generationThroughput);
        }

        runningRequests = firstMetric(engineMetrics, names.runningRequests);
        pendingRequests = firstMetric(engineMetrics, names.pendingRequests);
        kvCacheUsage = firstMetric(engineMetrics, names.kvCacheUsage);
        promptTokensTotal = firstMetric(engineMetrics, names.promptTokens);
        generationTokensTotal = firstMetric(engineMetrics, names.generationTokens);
        avgTtftMs = cumulativeTtftMs(engineMetrics, names);
        intervalTtft = intervalTtftMs(engineMetrics, lastEngineMetrics, names);
        if (intervalTtft > 0) recentTtftMs = intervalTtft;

        lastEngineMetrics = engineMetrics;
        lastMetricsTime = now;

        if (promptThroughput > 0 || generationThroughput > 0 || intervalTtft > 0) {
          yield* context.stores.peakMetricsStore.updateIfBetterEffect(
            modelId,
            promptThroughput > 0 ? promptThroughput : undefined,
            generationThroughput > 0 ? generationThroughput : undefined,
            intervalTtft > 0 ? intervalTtft : undefined,
          );
        }
      } else {
        lastEngineMetrics = {};
        lastMetricsTime = 0;
      }

      bumpPeak(sessionPeaks, "prompt_throughput", promptThroughput);
      bumpPeak(sessionPeaks, "generation_throughput", generationThroughput);
      bumpBestLower(sessionPeaks, "ttft_ms", intervalTtft);
      bumpPeak(sessionPeaks, "kv_cache_usage", kvCacheUsage);
      bumpPeak(sessionPeaks, "running_requests", runningRequests);
      bumpPeak(sessionPeaks, "power_watts", totalPowerWatts);
      bumpPeak(sessionPeaks, "vram_used_gb", totalVramUsedGb);

      if (sessionPeakId) {
        yield* context.stores.peakMetricsStore.updateSessionPeakEffect(
          sessionPeakId,
          modelId,
          sessionPeaks.prompt_throughput > 0 ? sessionPeaks.prompt_throughput : undefined,
          sessionPeaks.generation_throughput > 0 ? sessionPeaks.generation_throughput : undefined,
          sessionPeaks.ttft_ms > 0 ? sessionPeaks.ttft_ms : undefined,
        );
      }

      const peakData = yield* context.stores.peakMetricsStore.getEffect(modelId);
      const sessionPeakData = sessionPeakId
        ? yield* context.stores.peakMetricsStore.getSessionEffect(sessionPeakId)
        : null;
      const bestSessionPeakData =
        yield* context.stores.peakMetricsStore.getBestSessionEffect(modelId);
      const usageAggregate: UsageAggregate | null =
        yield* context.stores.inferenceRequestStore.aggregateEffect(new Set([modelId]));
      const usageTotals = usageAggregate?.totals;
      const usageLatencyAvg = positiveOrUndefined(usageAggregate?.latency?.avg_ms);
      const usageTtftAvg = positiveOrUndefined(usageAggregate?.ttft?.avg_ms);
      const promptTokensDisplay =
        positiveOrUndefined(promptTokensTotal) ?? positiveOrUndefined(usageTotals?.prompt_tokens);
      const generationTokensDisplay =
        positiveOrUndefined(generationTokensTotal) ??
        positiveOrUndefined(usageTotals?.completion_tokens);
      const avgTtftDisplay = avgTtftMs > 0 ? Math.round(avgTtftMs * 10) / 10 : (usageTtftAvg ?? 0);

      yield* context.eventManager.publishMetrics({
        ...baseMetrics,
        model_id: modelId,
        model_path: observation.modelPath,
        served_model_name: observation.servedModelName,
        running_requests: runningRequests,
        pending_requests: pendingRequests,
        kv_cache_usage: kvCacheUsage,
        prompt_tokens_total: promptTokensDisplay,
        generation_tokens_total: generationTokensDisplay,
        total_tokens: positiveOrUndefined(usageTotals?.total_tokens),
        total_requests: positiveOrUndefined(usageTotals?.total_requests),
        prompt_throughput: Math.round(promptThroughput * 10) / 10,
        generation_throughput: Math.round(generationThroughput * 10) / 10,
        avg_ttft_ms: avgTtftDisplay,
        recent_ttft_ms: recentTtftMs > 0 ? Math.round(recentTtftMs * 10) / 10 : undefined,
        latency_avg: usageLatencyAvg,
        vram_used_gb: Math.round(totalVramUsedGb * 10) / 10,
        vram_capacity_gb: Math.round(totalVramCapacityGb * 10) / 10,
        power_limit_watts: Math.round(totalPowerLimitWatts),
        session_peak_prompt_throughput: Math.round(sessionPeaks.prompt_throughput * 10) / 10,
        session_peak_generation_throughput:
          Math.round(sessionPeaks.generation_throughput * 10) / 10,
        session_peak_ttft_ms: Math.round(sessionPeaks.ttft_ms * 10) / 10,
        session_peak_kv_cache_usage: sessionPeaks.kv_cache_usage,
        session_peak_running_requests: sessionPeaks.running_requests,
        session_peak_power_watts: Math.round(sessionPeaks.power_watts),
        session_peak_vram_used_gb: Math.round(sessionPeaks.vram_used_gb * 10) / 10,
        session_peak_id: sessionPeakId,
        session_peak_prefill_tps: sessionPeakData?.["peak_prefill_tps"] ?? null,
        session_peak_generation_tps: sessionPeakData?.["peak_generation_tps"] ?? null,
        session_peak_best_ttft_ms: sessionPeakData?.["best_ttft_ms"] ?? null,
        best_session_peak_id: bestSessionPeakData?.["session_id"] ?? null,
        best_session_prefill_tps: bestSessionPeakData?.["peak_prefill_tps"] ?? null,
        best_session_generation_tps: bestSessionPeakData?.["peak_generation_tps"] ?? null,
        best_session_ttft_ms: bestSessionPeakData?.["best_ttft_ms"] ?? null,
        peak_prefill_tps: peakData?.["prefill_tps"] ?? null,
        peak_generation_tps: peakData?.["generation_tps"] ?? null,
        peak_ttft_ms: peakData?.["ttft_ms"] ?? null,
      });
    } else {
      sessionModelId = null;
      sessionPeakId = null;
      sessionPeaks = emptyPeaks();
      lastEngineMetrics = {};
      lastMetricsTime = 0;
      recentTtftMs = 0;
      bumpPeak(sessionPeaks, "power_watts", totalPowerWatts);
      bumpPeak(sessionPeaks, "vram_used_gb", totalVramUsedGb);
      yield* context.eventManager.publishMetrics({
        ...baseMetrics,
        model_id: null,
        model_path: null,
        served_model_name: null,
        vram_used_gb: Math.round(totalVramUsedGb * 10) / 10,
        vram_capacity_gb: Math.round(totalVramCapacityGb * 10) / 10,
        power_limit_watts: Math.round(totalPowerLimitWatts),
        session_peak_power_watts: Math.round(sessionPeaks.power_watts),
        session_peak_vram_used_gb: Math.round(sessionPeaks.vram_used_gb * 10) / 10,
      });
    }
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        context.logger.error("Metrics collection error", { error: String(error) });
      }),
    ),
  );

  return collect.pipe(
    Effect.repeat(Schedule.spaced(METRICS_COLLECT_INTERVAL_MS)),
    Effect.andThen(Effect.never),
  );
};
