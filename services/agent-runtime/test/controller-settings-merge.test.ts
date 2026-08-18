import { describe, expect, test } from "bun:test";
import { mergeControllers } from "../src/pi-runtime-models";

const settings = {
  backendUrl: "http://127.0.0.1:8080/",
  apiKey: "current-controller-key",
  voiceUrl: "",
  voiceModel: "",
};

describe("controller settings merge", () => {
  test("replaces a stale cached key for the configured primary controller", () => {
    expect(
      mergeControllers(settings, [
        {
          url: "http://127.0.0.1:8080",
          apiKey: "stale-controller-key",
          name: "primary",
        },
      ]),
    ).toEqual([
      {
        url: "http://127.0.0.1:8080",
        apiKey: "current-controller-key",
        name: "primary",
      },
    ]);
  });

  test("preserves credentials for additional controllers", () => {
    expect(
      mergeControllers(settings, [
        { url: "http://127.0.0.1:8080", apiKey: "stale-controller-key" },
        { url: "https://rig.example.test", apiKey: "rig-key", name: "rig" },
      ]),
    ).toEqual([
      {
        url: "http://127.0.0.1:8080",
        apiKey: "current-controller-key",
        name: "primary",
      },
      { url: "https://rig.example.test", apiKey: "rig-key", name: "rig" },
    ]);
  });

  test("keeps the cached key when server settings do not have one", () => {
    expect(
      mergeControllers({ ...settings, apiKey: "" }, [
        { url: "http://127.0.0.1:8080", apiKey: "cached-controller-key" },
      ]),
    ).toEqual([
      {
        url: "http://127.0.0.1:8080",
        apiKey: "cached-controller-key",
        name: "primary",
      },
    ]);
  });
});
