"use client";

import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import type { DashboardLayoutProps } from "@/features/dashboard/layout/dashboard-types";
import type {
  LinuxDashboardAlert,
  LinuxDashboardHealth,
  LinuxDashboardSnapshot,
} from "@/lib/types";
import { formatBytes, formatUptime } from "./dashboard-format";
import { formatGpuGb, formatGpuPower, GpuTelemetry, SystemOverview } from "./dashboard-charts";
import { type DashboardHistoryPoint } from "./dashboard-history";
import { DashboardModelRuntime, type DashboardHostSummary } from "./dashboard-model-runtime";
import {
  AlertStrip,
  ContainersTable,
  BackendsTable,
  DisksTable,
  Section,
  Sensors,
  ServicesTable,
} from "./dashboard-system-sections";
import { HostPowerConfirm } from "./host-power-confirm";

type LinuxDashboardViewProps = {
  data: LinuxDashboardSnapshot | null;
  history: DashboardHistoryPoint[];
  statusData: DashboardLayoutProps;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  autoRefresh: boolean;
  onAutoRefreshChange: (value: boolean) => void;
  onRefresh: () => void;
  onRestart: () => Promise<void>;
  onShutdown: () => Promise<void>;
};

export function LinuxDashboardView({
  data,
  history,
  statusData,
  loading,
  refreshing,
  error,
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
  onRestart,
  onShutdown,
}: LinuxDashboardViewProps) {
  const visibleAlerts = useMemo(
    () => (data ? data.alerts.filter((alert) => !isFanHwmonAlert(alert)) : []),
    [data],
  );
  const topStatus = useMemo<LinuxDashboardHealth>(() => {
    if (!data) return "unknown";
    if (visibleAlerts.some((alert) => alert.severity === "critical")) return "critical";
    if (visibleAlerts.some((alert) => alert.severity === "warning")) return "warning";
    return "ok";
  }, [data, visibleAlerts]);
  const summary = data ? buildSummary(data, history) : null;
  const dashboardControls = (
    <>
      <label className="inline-flex h-8 items-center gap-2 px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-(--dim) hover:bg-(--fg)/5">
        <input
          type="checkbox"
          checked={autoRefresh}
          onChange={(event) => onAutoRefreshChange(event.target.checked)}
          className="h-3 w-3 border-(--border) bg-transparent accent-(--fg)"
        />
        Auto
      </label>
      <button
        onClick={onRefresh}
        className="inline-flex h-8 items-center gap-2 px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-(--fg) hover:bg-(--fg)/5"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
        Refresh
      </button>
    </>
  );
  const dashboardTrailingControls = (
    <>
      <HostPowerConfirm
        action="restart"
        onConfirm={onRestart}
        trigger={({ open, running }) => (
          <button
            onClick={open}
            disabled={running}
            className="inline-flex h-8 items-center px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-(--err) hover:bg-(--err)/10 disabled:opacity-40"
          >
            {running ? "Restarting..." : "Restart"}
          </button>
        )}
      />
      <HostPowerConfirm
        action="shutdown"
        onConfirm={onShutdown}
        trigger={({ open, running }) => (
          <button
            onClick={open}
            disabled={running}
            className="inline-flex h-8 items-center px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-(--err) hover:bg-(--err)/10 disabled:opacity-40"
          >
            {running ? "Shutting..." : "Shut down"}
          </button>
        )}
      />
    </>
  );

  if (loading && !data) {
    return (
      <div className="flex min-h-full items-center justify-center bg-(--bg) font-mono text-xs text-(--dim)">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="min-h-full bg-(--bg) text-(--fg)">
      <div className="mx-auto max-w-[1600px] px-3 py-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-4 lg:px-5">
        <DashboardModelRuntime
          statusData={statusData}
          hostname={data?.host.hostname}
          healthStatus={topStatus}
          hostSummary={summary}
          controls={dashboardControls}
          trailingControls={dashboardTrailingControls}
        />

        {error ? (
          <div className="mt-4 border border-(--err)/35 px-3 py-2 font-mono text-[11px] text-(--err)">
            {error}
          </div>
        ) : null}

        {data ? (
          <main className="mt-3 space-y-2.5">
            {visibleAlerts.length > 0 ? <AlertStrip alerts={visibleAlerts} /> : null}

            <SystemOverview data={data} history={history} status={topStatus} />
            <GpuTelemetry data={data} history={history} />

            <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1.36fr)_minmax(0,0.84fr)_minmax(0,0.98fr)_minmax(0,1.18fr)]">
              <Section title="Disks">
                <DisksTable disks={data.disks} />
              </Section>
              <Section title="Services">
                <ServicesTable services={data.services} />
              </Section>

              <Section title="Backends">
                <BackendsTable
                  runtimeSummary={statusData.runtimeSummary}
                  knownBackendIds={knownBackendIds(statusData)}
                  activeBackend={statusData.currentProcess?.backend}
                />
              </Section>

              <Section title="Sensors / Thermals">
                <Sensors data={data} />
              </Section>
            </div>

            <Section title="Containers">
              <ContainersTable data={data} />
            </Section>
          </main>
        ) : null}
      </div>
    </div>
  );
}

function buildSummary(
  data: LinuxDashboardSnapshot,
  history: DashboardHistoryPoint[],
): DashboardHostSummary {
  const latestHistory = history.at(-1);
  const cpuValue =
    latestHistory?.cpu_usage_percent ?? data.cpu.usage_percent ?? data.cpu.load_percent_1m ?? null;
  const totalVramUsed = data.gpus.reduce((sum, gpu) => sum + gpu.memory_used_bytes, 0);
  const totalVram = data.gpus.reduce((sum, gpu) => sum + gpu.memory_total_bytes, 0);
  const gpuPower = sumFinite(data.gpus.map((gpu) => gpu.power_draw_watts));
  const systemPower = sumFinite([data.cpu.power_draw_watts, gpuPower]);

  return {
    cpu: cpuValue == null ? null : String(Math.round(cpuValue)),
    memory: `${formatGpuGb(data.memory.used_bytes)}/${formatGpuGb(data.memory.total_bytes)}`,
    vram: `${formatGpuGb(totalVramUsed)}/${formatGpuGb(totalVram)}`,
    power: formatGpuPower(systemPower, undefined),
    uptime: formatUptime(data.host.uptime_seconds),
  };
}

function isFanHwmonAlert(alert: LinuxDashboardAlert): boolean {
  const message = alert.message.toLowerCase();
  return message.includes("fan rpm") && message.includes("hwmon");
}

function knownBackendIds(statusData: DashboardLayoutProps): string[] {
  const values = new Set<string>();
  if (statusData.currentProcess?.backend) values.add(statusData.currentProcess.backend);
  for (const recipe of statusData.recipes) {
    if (recipe.backend) values.add(recipe.backend);
  }
  return [...values].sort((left, right) => {
    if (left === statusData.currentProcess?.backend) return -1;
    if (right === statusData.currentProcess?.backend) return 1;
    return left.localeCompare(right);
  });
}

function sumFinite(values: Array<number | null | undefined>): number | null {
  const total = values.reduce<number>(
    (sum, value) => (typeof value === "number" && Number.isFinite(value) ? sum + value : sum),
    0,
  );
  return total > 0 ? total : null;
}
