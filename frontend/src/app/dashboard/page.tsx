"use client";

import { useCallback, useRef, useState } from "react";
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

export default function LinuxDashboardPage() {
  const statusData = useDashboardData();
  const [data, setData] = useState<LinuxDashboardSnapshot | null>(null);
  const [history, setHistory] = useState<DashboardHistoryPoint[]>(loadStoredDashboardHistory);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const hasSnapshotRef = useRef(false);

  const applySnapshot = useCallback((next: LinuxDashboardSnapshot) => {
    hasSnapshotRef.current = true;
    setData(next);
    setHistory((previous) => {
      const updated = appendDashboardHistory(previous, next);
      storeDashboardHistory(updated);
      return updated;
    });
  }, []);

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
