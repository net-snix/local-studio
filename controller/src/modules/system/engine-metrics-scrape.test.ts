import { describe, expect, it } from "bun:test";
import { parseEngineMetrics } from "./engine-metrics-scrape";

describe("parseEngineMetrics", () => {
  it("parses labeled and unlabeled series and flags the engine family", () => {
    const scrape = parseEngineMetrics(
      200,
      [
        "# HELP vllm:prompt_tokens_total Number of prefill tokens processed.",
        'vllm:prompt_tokens_total{model_name="glm"} 1200',
        "vllm:num_preemptions_total 3",
      ].join("\n"),
    );

    expect(scrape.hasVllm).toBe(true);
    expect(scrape.modelName).toBe("glm");
    expect(scrape.metrics["vllm:prompt_tokens_total"]).toBe(1200);
    expect(scrape.metrics["vllm:num_preemptions_total"]).toBe(3);
  });

  it("sums counters and request gauges across multiple label sets", () => {
    const scrape = parseEngineMetrics(
      200,
      [
        'vllm:prompt_tokens_total{model_name="glm",engine="0"} 1000',
        'vllm:prompt_tokens_total{model_name="glm",engine="1"} 250',
        'vllm:time_to_first_token_seconds_sum{engine="0"} 1.5',
        'vllm:time_to_first_token_seconds_sum{engine="1"} 0.5',
        'vllm:time_to_first_token_seconds_count{engine="0"} 3',
        'vllm:time_to_first_token_seconds_count{engine="1"} 1',
        'vllm:num_requests_running{engine="0"} 2',
        'vllm:num_requests_running{engine="1"} 3',
      ].join("\n"),
    );

    expect(scrape.metrics["vllm:prompt_tokens_total"]).toBe(1250);
    expect(scrape.metrics["vllm:time_to_first_token_seconds_sum"]).toBe(2);
    expect(scrape.metrics["vllm:time_to_first_token_seconds_count"]).toBe(4);
    expect(scrape.metrics["vllm:num_requests_running"]).toBe(5);
  });

  it("averages percent-style gauges across multiple label sets", () => {
    const scrape = parseEngineMetrics(
      200,
      ['vllm:kv_cache_usage_perc{engine="0"} 0.4', 'vllm:kv_cache_usage_perc{engine="1"} 0.6'].join(
        "\n",
      ),
    );

    expect(scrape.metrics["vllm:kv_cache_usage_perc"]).toBeCloseTo(0.5);
  });

  it("returns an empty scrape for non-200 responses", () => {
    const scrape = parseEngineMetrics(503, "vllm:prompt_tokens_total 5");
    expect(scrape.status).toBe(503);
    expect(scrape.metrics).toEqual({});
  });
});
