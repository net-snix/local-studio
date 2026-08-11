import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { Effect } from "effect";
import type { Exit } from "effect";
import type { AppContext } from "../../src/app-context";
import type { ControllerRuntime } from "../../src/core/effect-runtime";
import {
  controllerRuntimeMiddleware,
  type ControllerEnvironment,
} from "../../src/http/effect-handler";
import { registerLinuxDashboardRoutes } from "../../src/modules/system/linux-dashboard/linux-dashboard-routes";

const runtime = {
  runPromiseExit: <A, E>(effect: Effect.Effect<A, E>): Promise<Exit.Exit<A, E>> =>
    Effect.runPromiseExit(effect),
} as unknown as ControllerRuntime;

const makeApp = (): Hono<ControllerEnvironment> => {
  const app = new Hono<ControllerEnvironment>();
  app.use("*", controllerRuntimeMiddleware(runtime));
  return app;
};

describe("linux dashboard routes", () => {
  it("returns a host snapshot", async () => {
    const app = makeApp();
    const context = {
      config: {
        port: 8080,
        inference_port: 8000,
      },
      logger: {
        debug: mock(() => undefined),
        info: mock(() => undefined),
        warn: mock(() => undefined),
        error: mock(() => undefined),
      },
    } as unknown as AppContext;

    registerLinuxDashboardRoutes(app, context);

    const response = await app.request("/linux-dashboard");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty("host");
    expect(body.host).toHaveProperty("hostname");
    expect(body.host).toHaveProperty("cpu_model");
    expect(body.host).toHaveProperty("cpu_physical_cores");
    expect(body.host).toHaveProperty("cpu_threads");
    expect(body).toHaveProperty("cpu");
    expect(body).toHaveProperty("memory");
    expect(Array.isArray(body.disks)).toBe(true);
    expect(body.disks[0]).toHaveProperty("device");
    expect(body.disks[0]).toHaveProperty("device_model");
    expect(Array.isArray(body.services)).toBe(true);
    expect(body.services).toContainEqual(
      expect.objectContaining({
        id: "lact",
        endpoint: "socket",
        status: expect.stringMatching(/^(running|stopped)$/),
      }),
    );
    expect(Array.isArray(body.alerts)).toBe(true);
  });

  it("streams dashboard snapshots as SSE", async () => {
    const app = makeApp();
    const context = {
      config: {
        port: 8080,
        inference_port: 8000,
      },
      logger: {
        debug: mock(() => undefined),
        info: mock(() => undefined),
        warn: mock(() => undefined),
        error: mock(() => undefined),
      },
    } as unknown as AppContext;

    registerLinuxDashboardRoutes(app, context);

    const abort = new AbortController();
    const response = await app.request("/linux-dashboard/stream", {
      signal: abort.signal,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    const timeout = setTimeout(() => abort.abort(), 3_000);
    let text = "";
    while (!text.includes("event: linux-dashboard")) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    clearTimeout(timeout);
    abort.abort();
    await reader?.cancel().catch(() => undefined);

    expect(text).toContain("event: linux-dashboard");
    expect(text).toContain('"host"');
  });
});
