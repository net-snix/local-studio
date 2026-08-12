import { describe, expect, test } from "bun:test";
import { modelsToPiModels } from "../src/pi-runtime-models";

describe("Controller-backed DeepSeek thinking levels", () => {
  test("maps levels to encoder-valid reasoning_effort values including max", () => {
    const [model] = modelsToPiModels([
      {
        id: "deepseek-v4-flash-0731-256k",
        name: "DeepSeek V4 Flash 0731 (Docker r30, 256k Fast)",
        provider: "local-studio",
        controllerUrl: "http://127.0.0.1:8080",
        contextWindow: 262_144,
        maxTokens: 32_768,
        reasoning: true,
        vision: false,
        active: true,
      },
    ]);

    // The DS4 encoder defines low/high/max; medium maps up, off/minimal hide.
    expect(model?.thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: "low",
      medium: "high",
      high: "high",
      xhigh: "max",
      max: "max",
    });
    expect(model?.compat.supportsReasoningEffort).toBe(true);
  });

  test("hosted DeepSeek models keep the hosted map", () => {
    const [model] = modelsToPiModels([
      {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        provider: "deepseek",
        contextWindow: 131_072,
        maxTokens: 32_768,
        reasoning: true,
        vision: false,
        active: true,
      },
    ]);
    expect(model?.thinkingLevelMap?.medium).toBe("medium");
  });
});
