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
      const abort = new AbortController();
      let reconnectId: number | null = null;

      const connect = async (): Promise<void> => {
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
          setRefreshing(false);
          if (!abort.signal.aborted) {
            reconnectId = window.setTimeout(() => void connect(), STREAM_RECONNECT_MS);
          }
        }
      };

      void connect();

      return () => {
        if (reconnectId !== null) window.clearTimeout(reconnectId);
        abort.abort();
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
