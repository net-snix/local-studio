"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useDashboardData } from "@/features/dashboard/use-dashboard-data";
import { useLinuxDashboardEffects } from "@/features/agent/ui/use-linux-dashboard-effects";
import api from "@/lib/api/client";
import type { LinuxDashboardSnapshot } from "@/lib/types";
import {
  appendDashboardHistory,
  loadStoredDashboardHistory,
  storeDashboardHistory,
  type DashboardHistoryPoint,
} from "./dashboard-history";
import { LinuxDashboardView } from "./dashboard-view";

const HISTORY_STORE_INTERVAL_MS = 10_000;

const historyFlushSnapshot = (): number => 0;

export default function LinuxDashboardPage() {
  const statusData = useDashboardData();
  const [data, setData] = useState<LinuxDashboardSnapshot | null>(null);
  const [history, setHistory] = useState<DashboardHistoryPoint[]>(loadStoredDashboardHistory);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const hasSnapshotRef = useRef(false);
  const historyRef = useRef<DashboardHistoryPoint[]>([]);
  const lastHistoryStoreAtRef = useRef(0);

  const applySnapshot = useCallback((next: LinuxDashboardSnapshot) => {
    hasSnapshotRef.current = true;
    setData(next);
    setHistory((previous) => {
      const updated = appendDashboardHistory(previous, next);
      historyRef.current = updated;
      // Persisting serializes the whole history synchronously; at the stream's 1s
      // cadence that is real main-thread cost, so batch writes and flush on hide.
      const now = Date.now();
      if (now - lastHistoryStoreAtRef.current >= HISTORY_STORE_INTERVAL_MS) {
        lastHistoryStoreAtRef.current = now;
        storeDashboardHistory(updated);
      }
      return updated;
    });
  }, []);

  const subscribeHistoryFlush = useCallback((_notify: () => void) => {
    const flush = (): void => {
      if (historyRef.current.length === 0) return;
      lastHistoryStoreAtRef.current = Date.now();
      storeDashboardHistory(historyRef.current);
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, []);
  useSyncExternalStore(subscribeHistoryFlush, historyFlushSnapshot, historyFlushSnapshot);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "refresh") => {
      try {
        if (mode === "initial") setLoading(true);
        setRefreshing(true);
        setError(null);
        const next = await api.getLinuxDashboard({ timeout: 12_000, retries: 0 });
        applySnapshot(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [applySnapshot],
  );

  useLinuxDashboardEffects({
    applySnapshot,
    autoRefresh,
    data,
    hasSnapshotRef,
    load,
    setError,
    setLoading,
    setRefreshing,
  });

  return (
    <LinuxDashboardView
      data={data}
      history={history}
      statusData={statusData}
      loading={loading}
      refreshing={refreshing}
      error={error}
      autoRefresh={autoRefresh}
      onAutoRefreshChange={setAutoRefresh}
      onRefresh={() => void load()}
      onRestart={async () => {
        await api.restartHost();
      }}
      onShutdown={async () => {
        await api.shutdownHost();
      }}
    />
  );
}
