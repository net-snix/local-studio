import { Effect, Stream } from "effect";
import type { AppContext } from "../../../app-context";
import { effectHandler } from "../../../http/effect-handler";
import { defineRoutes } from "../../../http/route-registrar";
import { buildSseHeaders, toReadableByteStream, withSseHeartbeat } from "../../../http/sse";
import { collectLinuxDashboardSnapshot } from "./linux-dashboard-collector";
import {
  LinuxDashboardTelemetry,
  type LinuxDashboardTelemetryEvent,
} from "./linux-dashboard-telemetry";
import { scheduleHostRestart, scheduleHostShutdown } from "../host-shutdown";

const telemetryByContext = new WeakMap<AppContext, LinuxDashboardTelemetry>();

const getTelemetry = (context: AppContext): LinuxDashboardTelemetry => {
  const existing = telemetryByContext.get(context);
  if (existing) return existing;
  const telemetry = new LinuxDashboardTelemetry(() => collectLinuxDashboardSnapshot(context));
  telemetryByContext.set(context, telemetry);
  return telemetry;
};

const telemetryEventToSse = (event: LinuxDashboardTelemetryEvent): string => {
  if (event.type === "snapshot") {
    return [
      `id: ${Date.parse(event.snapshot.collected_at)}`,
      "event: linux-dashboard",
      `data: ${JSON.stringify(event.snapshot)}`,
      "",
      "",
    ].join("\n");
  }

  return [
    `id: ${Date.now()}`,
    "event: linux-dashboard-error",
    `data: ${JSON.stringify({ message: event.message, timestamp: event.timestamp })}`,
    "",
    "",
  ].join("\n");
};

export const registerLinuxDashboardRoutes = defineRoutes((app, context) => {
  app.get(
    "/linux-dashboard",
    effectHandler((ctx) =>
      getTelemetry(context)
        .getSnapshot()
        .pipe(Effect.map((snapshot) => ctx.json(snapshot))),
    ),
  );

  app.get(
    "/linux-dashboard/stream",
    effectHandler((ctx) =>
      Effect.sync(() => {
        const signal = ctx.req.raw.signal;
        const telemetry = getTelemetry(context);
        const frames = telemetry.subscribe(signal).pipe(Stream.map(telemetryEventToSse));
        return new Response(toReadableByteStream(withSseHeartbeat(frames, 15_000, signal)), {
          headers: buildSseHeaders(),
        });
      }),
    ),
  );

  app.post(
    "/linux-dashboard/shutdown",
    effectHandler((ctx) =>
      Effect.sync(() => {
        const result = scheduleHostShutdown();
        if (!result.success) {
          return ctx.json({ success: false, error: result.error }, { status: 500 });
        }
        context.logger.warn("Host shutdown requested from dashboard");
        return ctx.json({
          success: true,
          message: "Shutdown scheduled",
          command: result.command,
        });
      }),
    ),
  );

  return app.post(
    "/linux-dashboard/restart",
    effectHandler((ctx) =>
      Effect.sync(() => {
        const result = scheduleHostRestart();
        if (!result.success) {
          return ctx.json({ success: false, error: result.error }, { status: 500 });
        }
        context.logger.warn("Host restart requested from dashboard");
        return ctx.json({
          success: true,
          message: "Restart scheduled",
          command: result.command,
        });
      }),
    ),
  );
});
