import {
  useCallback,
  useSyncExternalStore,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import api from "@/lib/api/client";
import type { LinuxDashboardSnapshot } from "@/lib/types";

const STREAM_RECONNECT_MS = 2_000;

type LoadDashboardSnapshot = (mode?: "initial" | "refresh") => Promise<void>;

type UseLinuxDashboardEffectsArgs = {
  applySnapshot: (next: LinuxDashboardSnapshot) => void;
  autoRefresh: boolean;
  data: LinuxDashboardSnapshot | null;
  hasSnapshotRef: RefObject<boolean>;
  load: LoadDashboardSnapshot;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setRefreshing: Dispatch<SetStateAction<boolean>>;
};

const isLinuxDashboardSnapshot = (value: unknown): value is LinuxDashboardSnapshot => {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return (
    typeof snapshot["collected_at"] === "string" &&
    typeof snapshot["host"] === "object" &&
    snapshot["host"] !== null &&
    typeof snapshot["cpu"] === "object" &&
    snapshot["cpu"] !== null &&
    typeof snapshot["memory"] === "object" &&
    snapshot["memory"] !== null &&
    Array.isArray(snapshot["gpus"])
  );
};

export function useLinuxDashboardEffects({
  applySnapshot,
  autoRefresh,
  data,
  hasSnapshotRef,
  load,
  setError,
  setLoading,
  setRefreshing,
}: UseLinuxDashboardEffectsArgs) {
  const subscribeInitialLoad = useCallback(
    (notify: () => void) => {
      if (autoRefresh || data) return () => {};
      let cancelled = false;
      void load("initial").finally(() => {
        if (!cancelled) notify();
      });
      return () => {
        cancelled = true;
      };
    },
    [autoRefresh, data, load],
  );

  const subscribeDashboardStream = useCallback(
    (_notify: () => void) => {
      if (!autoRefresh) return () => {};
      let disposed = false;
      let streamAbort: AbortController | null = null;
      let reconnectId: number | null = null;
      let resumePromise: Promise<void> | null = null;

      const clearReconnect = (): void => {
        if (reconnectId === null) return;
        window.clearTimeout(reconnectId);
        reconnectId = null;
      };

      const disconnect = (): void => {
        clearReconnect();
        streamAbort?.abort();
        streamAbort = null;
      };

      const isVisible = (): boolean => document.visibilityState === "visible";

      const connect = async (): Promise<void> => {
        if (disposed || !isVisible() || streamAbort) return;
        const abort = new AbortController();
        streamAbort = abort;
        try {
          setRefreshing(true);
          setError(null);
          const stream = await api.streamLinuxDashboard({ signal: abort.signal });
          setRefreshing(false);
          for await (const event of stream) {
            if (abort.signal.aborted) break;
            if (event.event === "linux-dashboard") {
              if (isLinuxDashboardSnapshot(event.data)) {
                applySnapshot(event.data);
                setLoading(false);
                setError(null);
              }
              continue;
            }
            if (event.event === "linux-dashboard-error") {
              const message = event.data["message"];
              setError(typeof message === "string" ? message : "Dashboard stream failed");
            }
          }
        } catch (err) {
          if (!abort.signal.aborted) {
            setError(err instanceof Error ? err.message : String(err));
            if (!hasSnapshotRef.current) void load("initial");
          }
        } finally {
          if (streamAbort === abort) streamAbort = null;
          setRefreshing(false);
          if (!disposed && !abort.signal.aborted && isVisible()) {
            clearReconnect();
            reconnectId = window.setTimeout(() => {
              reconnectId = null;
              void connect();
            }, STREAM_RECONNECT_MS);
          }
        }
      };

      const resume = (): void => {
        if (disposed || !isVisible()) return;
        disconnect();
        if (resumePromise) return;
        resumePromise = load(hasSnapshotRef.current ? "refresh" : "initial").finally(() => {
          resumePromise = null;
          if (!disposed && isVisible()) void connect();
        });
      };

      const unsubscribeResume = subscribeLinuxDashboardResume(document, window, {
        onHidden: () => {
          disconnect();
          setRefreshing(false);
        },
        onVisible: resume,
      });

      void connect();

      return () => {
        disposed = true;
        unsubscribeResume();
        disconnect();
      };
    },
    [applySnapshot, autoRefresh, hasSnapshotRef, load, setError, setLoading, setRefreshing],
  );

  useSyncExternalStore(
    subscribeInitialLoad,
    getLinuxDashboardEffectsSnapshot,
    getLinuxDashboardEffectsSnapshot,
  );
  useSyncExternalStore(
    subscribeDashboardStream,
    getLinuxDashboardEffectsSnapshot,
    getLinuxDashboardEffectsSnapshot,
  );
}

const getLinuxDashboardEffectsSnapshot = (): number => 0;

type DashboardResumeCallbacks = {
  onHidden: () => void;
  onVisible: () => void;
};

type DashboardVisibilityTarget = EventTarget & {
  visibilityState: DocumentVisibilityState;
};

export function subscribeLinuxDashboardResume(
  documentTarget: DashboardVisibilityTarget,
  windowTarget: EventTarget,
  callbacks: DashboardResumeCallbacks,
): () => void {
  let active = documentTarget.visibilityState === "visible";
  const resumeWhenVisible = (): void => {
    if (documentTarget.visibilityState !== "visible" || active) return;
    active = true;
    callbacks.onVisible();
  };
  const pause = (): void => {
    if (!active) return;
    active = false;
    callbacks.onHidden();
  };
  const onVisibility = (): void => {
    if (documentTarget.visibilityState === "visible") resumeWhenVisible();
    else pause();
  };
  const onPageShow = (event: Event): void => {
    if (!(event as PageTransitionEvent).persisted) return;
    active = false;
    resumeWhenVisible();
  };

  documentTarget.addEventListener("visibilitychange", onVisibility);
  windowTarget.addEventListener("blur", pause);
  windowTarget.addEventListener("focus", resumeWhenVisible);
  windowTarget.addEventListener("pageshow", onPageShow);

  return () => {
    documentTarget.removeEventListener("visibilitychange", onVisibility);
    windowTarget.removeEventListener("blur", pause);
    windowTarget.removeEventListener("focus", resumeWhenVisible);
    windowTarget.removeEventListener("pageshow", onPageShow);
  };
}
