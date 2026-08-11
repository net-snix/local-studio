import { Effect, Fiber, PubSub, Semaphore, Stream } from "effect";
import type { Scope } from "effect";
import type { LinuxDashboardSnapshot } from "./linux-dashboard-types";

const DEFAULT_INTERVAL_MS = 1_000;
const SUBSCRIBER_QUEUE_SIZE = 2;

export type LinuxDashboardTelemetryEvent =
  | { type: "snapshot"; snapshot: LinuxDashboardSnapshot }
  | { type: "error"; message: string; timestamp: string };

export type LinuxDashboardTelemetryOptions = {
  intervalMs?: number;
};

type SnapshotCollector = () => Effect.Effect<LinuxDashboardSnapshot, unknown>;

type TelemetrySubscription = {
  subscription: PubSub.Subscription<LinuxDashboardTelemetryEvent>;
  latest: LinuxDashboardSnapshot | null;
  pubsub: PubSub.PubSub<LinuxDashboardTelemetryEvent>;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const abortEffect = (signal?: AbortSignal): Effect.Effect<void> =>
  signal
    ? Effect.callback<void>((resume) => {
        if (signal.aborted) {
          resume(Effect.void);
          return;
        }
        const abort = (): void => resume(Effect.void);
        signal.addEventListener("abort", abort, { once: true });
        return Effect.sync(() => signal.removeEventListener("abort", abort));
      })
    : Effect.never;

export class LinuxDashboardTelemetry {
  private readonly collectSnapshot: SnapshotCollector;
  private readonly intervalMs: number;
  private readonly stateLock = Semaphore.makeUnsafe(1);
  private readonly collectionLock = Semaphore.makeUnsafe(1);
  private events: PubSub.PubSub<LinuxDashboardTelemetryEvent> | null = null;
  private latest: LinuxDashboardSnapshot | null = null;
  private lastCollectedAtMs = 0;
  private subscribers = 0;
  private loopFiber: Fiber.Fiber<void, never> | null = null;

  public constructor(
    collectSnapshot: SnapshotCollector,
    options: LinuxDashboardTelemetryOptions = {},
  ) {
    this.collectSnapshot = collectSnapshot;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  public get latestSnapshot(): LinuxDashboardSnapshot | null {
    return this.latest;
  }

  public getSnapshot(): Effect.Effect<LinuxDashboardSnapshot, unknown> {
    const telemetry = this;
    return this.collectionLock.withPermit(
      Effect.gen(function* () {
        if (
          telemetry.latest &&
          Date.now() - telemetry.lastCollectedAtMs < telemetry.intervalMs * 2
        ) {
          return telemetry.latest;
        }
        return yield* telemetry.collectOnce();
      }),
    );
  }

  public subscribe(signal?: AbortSignal): Stream.Stream<LinuxDashboardTelemetryEvent> {
    const stream = Stream.unwrap(
      Effect.acquireRelease(this.acquire(), (state) => this.release(state.pubsub)).pipe(
        Effect.map(({ subscription, latest }) => {
          const events = Stream.fromEffectRepeat(PubSub.take(subscription));
          return latest
            ? Stream.concat(
                Stream.succeed<LinuxDashboardTelemetryEvent>({
                  type: "snapshot",
                  snapshot: latest,
                }),
                events,
              )
            : events;
        }),
      ),
    );
    return Stream.scoped(stream).pipe(Stream.interruptWhen(abortEffect(signal)));
  }

  private acquire(): Effect.Effect<TelemetrySubscription, never, Scope.Scope> {
    const telemetry = this;
    return this.stateLock.withPermit(
      Effect.gen(function* () {
        const pubsub =
          telemetry.events ??
          (yield* PubSub.sliding<LinuxDashboardTelemetryEvent>(SUBSCRIBER_QUEUE_SIZE));
        telemetry.events = pubsub;
        const subscription = yield* PubSub.subscribe(pubsub);
        telemetry.subscribers += 1;
        if (!telemetry.loopFiber) {
          telemetry.loopFiber = yield* Effect.forkDetach(telemetry.runLoop());
        }
        return { subscription, latest: telemetry.latest, pubsub };
      }),
    );
  }

  private release(pubsub: PubSub.PubSub<LinuxDashboardTelemetryEvent>): Effect.Effect<void> {
    const telemetry = this;
    return this.stateLock.withPermit(
      Effect.gen(function* () {
        if (telemetry.events !== pubsub) return;
        telemetry.subscribers = Math.max(0, telemetry.subscribers - 1);
        if (telemetry.subscribers > 0) return;
        const fiber = telemetry.loopFiber;
        telemetry.loopFiber = null;
        telemetry.events = null;
        if (fiber) yield* Fiber.interrupt(fiber);
        yield* PubSub.shutdown(pubsub);
      }),
    );
  }

  private runLoop(): Effect.Effect<void> {
    const telemetry = this;
    return Effect.gen(function* () {
      if (telemetry.lastCollectedAtMs > 0) {
        const remainingMs = telemetry.intervalMs - (Date.now() - telemetry.lastCollectedAtMs);
        if (remainingMs > 0) yield* Effect.sleep(remainingMs);
      }
      while (true) {
        const startedAt = Date.now();
        yield* telemetry.collectionLock
          .withPermit(telemetry.collectOnce())
          .pipe(Effect.catch(() => Effect.void));
        const elapsedMs = Date.now() - startedAt;
        yield* Effect.sleep(Math.max(100, telemetry.intervalMs - elapsedMs));
      }
    });
  }

  private collectOnce(): Effect.Effect<LinuxDashboardSnapshot, unknown> {
    const telemetry = this;
    return this.collectSnapshot().pipe(
      Effect.tap((snapshot) =>
        Effect.gen(function* () {
          telemetry.latest = snapshot;
          telemetry.lastCollectedAtMs = Date.now();
          yield* telemetry.publish({ type: "snapshot", snapshot });
        }),
      ),
      Effect.tapError((error) =>
        telemetry.publish({
          type: "error",
          message: errorMessage(error),
          timestamp: new Date().toISOString(),
        }),
      ),
    );
  }

  private publish(event: LinuxDashboardTelemetryEvent): Effect.Effect<void> {
    return this.events ? PubSub.publish(this.events, event).pipe(Effect.asVoid) : Effect.void;
  }
}
