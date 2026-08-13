import { describe, expect, test } from "bun:test";
import { supportedPiThinkingLevels } from "../src/pi-runtime-models";

describe("User pi provider thinking levels", () => {
  // Mirrors the local-dsv4 provider config: DS4 Flash served by vLLM with the
  // chat-template thinking format, where reasoning_effort travels in
  // chat_template_kwargs and the provider therefore reports
  // supportsReasoningEffort: false.
  const ds4Flash = {
    id: "deepseek-v4-flash-0731-256k",
    reasoning: true,
    thinkingLevelMap: {
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: null,
      max: "max",
    },
    compat: { thinkingFormat: "chat-template" },
  };

  test("explicit thinkingLevelMap wins over supportsReasoningEffort: false", () => {
    expect(
      supportedPiThinkingLevels(ds4Flash, true, { supportsReasoningEffort: false }),
    ).toEqual(["off", "low", "high", "max"]);
  });

  test("without a map, an effort-less provider still pins high", () => {
    expect(
      supportedPiThinkingLevels({ id: "some-reasoner", reasoning: true }, true, {
        supportsReasoningEffort: false,
      }),
    ).toEqual(["high"]);
  });

  test("non-reasoning models stay off", () => {
    expect(supportedPiThinkingLevels({ id: "plain-model" }, false)).toEqual(["off"]);
  });
});
