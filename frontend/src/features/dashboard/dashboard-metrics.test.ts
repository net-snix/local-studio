import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Metrics, ProcessInfo } from "@/lib/types";
import { metricsBelongToProcess, scopedMetrics } from "./dashboard-metrics";

const managedProcess: ProcessInfo = {
  pid: 42,
  backend: "vllm",
  model_path: "/models/managed-model",
  port: 8000,
  served_model_name: "managed-model",
};

describe("dashboard metric identity", () => {
  test("accepts identified metrics from an externally managed endpoint", () => {
    const metrics: Metrics = {
      model_id: "deepseek-v4-flash-0731",
      generation_throughput: 145,
      prompt_throughput: 53_668,
      avg_ttft_ms: 605.9,
    };

    assert.equal(metricsBelongToProcess(metrics, null), true);
    assert.equal(scopedMetrics(metrics, null), metrics);
  });

  test("rejects base telemetry without an engine identity", () => {
    const metrics: Metrics = { current_power_watts: 600, vram_used_gb: 250 };

    assert.equal(metricsBelongToProcess(metrics, null), false);
    assert.equal(scopedMetrics(metrics, null), null);
  });

  test("keeps strict identity matching for a managed process", () => {
    const metrics: Metrics = {
      model_id: "different-model",
      generation_throughput: 100,
    };

    assert.equal(metricsBelongToProcess(metrics, managedProcess), false);
    assert.equal(scopedMetrics(metrics, managedProcess), null);
  });
});
