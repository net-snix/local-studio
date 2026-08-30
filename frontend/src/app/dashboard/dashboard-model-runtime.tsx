"use client";

import { Square } from "@/ui/icon-registry";
import { ModelStopConfirm } from "@/features/dashboard/model-stop-confirm";
import { ModelsDropdown } from "@/features/dashboard/control-panel/status-section-models-dropdown";
import { benchmarkButtonLabel } from "@/features/dashboard/control-panel/status-section-parts";
import type { DashboardLayoutProps } from "@/features/dashboard/layout/dashboard-types";
import { useModelLifecycle } from "@/features/dashboard/use-model-lifecycle";
import type { LinuxDashboardHealth } from "@/lib/types";
import { buildRuntimeSummary } from "./dashboard-runtime-summary";

type DashboardModelRuntimeProps = {
  statusData: DashboardLayoutProps;
  hostname?: string;
  healthStatus?: LinuxDashboardHealth;
  hostSummary?: DashboardHostSummary | null;
  controls?: React.ReactNode;
  trailingControls?: React.ReactNode;
};

export type DashboardHostSummary = {
  cpu: string | null;
  memory: string;
  vram: string;
  power: string;
  uptime: string;
};

const HEALTH_LABELS: Record<LinuxDashboardHealth, string> = {
  ok: "Active",
  warning: "Warning",
  critical: "Critical",
  unknown: "Unknown",
};

export function DashboardModelRuntime({
  statusData,
  hostname,
  healthStatus = "unknown",
  hostSummary,
  controls,
  trailingControls,
}: DashboardModelRuntimeProps) {
  const runtime = buildRuntimeSummary(statusData);
  const hostLabel = hostname ?? "Linux host";
  const title = `${hostLabel} - ${runtime.modelName}`;

  return (
    <section className="px-2 pt-2 pb-1">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[length:var(--fs-sm)]">
            <span className={`h-1.5 w-1.5 shrink-0 ${healthDotClass(healthStatus)}`} />
            <span className="inline-block w-[5.75rem] font-medium text-(--dim)">
              {HEALTH_LABELS[healthStatus]}
            </span>
            <Tag>linux</Tag>
            {runtime.backend ? <Tag>{runtime.backend}</Tag> : null}
            {runtime.platform ? <Tag>{runtime.platform}</Tag> : null}
            {runtime.port ? (
              <span className="font-mono text-[length:var(--fs-xs)] tabular-nums text-(--dim)/70">
                :{runtime.port}
              </span>
            ) : null}
          </div>
          <h1
            className="mt-1.5 min-w-0 text-[length:var(--fs-2xl)] font-semibold leading-tight tracking-[-0.01em] text-(--fg) sm:text-[length:var(--fs-3xl)]"
            title={title}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 break-words">{hostLabel}</span>
              <span aria-hidden="true" className="h-5 w-px shrink-0 bg-(--fg)/35" />
              <span className="min-w-0 break-words">{runtime.modelName}</span>
            </span>
          </h1>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {controls}
          <HeaderStopButton running={runtime.controllable} />
          <ModelsDropdown
            recipes={statusData.recipes}
            currentRecipeId={statusData.currentRecipe?.id}
            lifecycleStatus={statusData.lifecycleStatus}
            onLaunch={statusData.onLaunch}
            onNewRecipe={statusData.onNewRecipe}
            onViewAll={statusData.onViewAll}
          />
          <ActionBtn label="Logs" onClick={statusData.onNavigateLogs} />
          <ActionBtn
            label={benchmarkButtonLabel(statusData.benchmarking, statusData.benchmarkResult)}
            onClick={statusData.onBenchmark}
            disabled={!runtime.controllable || statusData.benchmarking}
          />
          {trailingControls}
        </div>
      </div>

      <RuntimeMetricStrip runtime={runtime} hostSummary={hostSummary} />

      <dl className="mt-3 grid gap-x-8 gap-y-1 text-[length:var(--fs-xs)] text-(--dim) sm:grid-cols-2 xl:grid-cols-4">
        <RuntimeStat label="Total tokens" value={runtime.totalTokens} />
        <RuntimeStat label="Prompt tokens" value={runtime.promptTokens} />
        <RuntimeStat label="Completion tokens" value={runtime.completionTokens} />
        <RuntimeStat label="Duration" value={runtime.duration} />
      </dl>
    </section>
  );
}

function RuntimeMetricStrip({
  runtime,
  hostSummary,
}: {
  runtime: ReturnType<typeof buildRuntimeSummary>;
  hostSummary?: DashboardHostSummary | null;
}) {
  return (
    <dl className="mt-4 grid w-full grid-cols-3 gap-x-4 gap-y-3 border-b border-(--separator) pb-4 sm:mt-5 sm:gap-x-8 sm:gap-y-4 sm:pb-5 lg:grid-cols-4 xl:grid-cols-8">
      <MetricCell
        label="Decode"
        value={runtime.decode ?? "0"}
        unit={runtime.decode ? "tok/s" : undefined}
        detail={runtime.decodePeak}
      />
      <MetricCell
        label="TTFT"
        value={runtime.ttft ?? "0"}
        unit={runtime.ttft ? "ms" : undefined}
        detail={runtime.ttftPeak}
      />
      <MetricCell
        label="Prefill"
        value={runtime.prefill ?? "0"}
        unit={runtime.prefill ? "tok/s" : undefined}
        detail={runtime.prefillPeak}
      />
      <MetricCell label="Requests" value={runtime.requests ?? "—"} />
      <MetricCell label="VRAM" value={runtime.vram ?? "—"} />
      <MetricCell label="GPU power" value={runtime.power ?? "—"} />
      <MetricCell label="System power" value={hostSummary?.power ?? "—"} />
      <MetricCell label="Uptime" value={hostSummary?.uptime ?? "—"} />
    </dl>
  );
}

function HeaderStopButton({ running }: { running: boolean }) {
  const { stop } = useModelLifecycle();
  if (!running) return null;

  return (
    <ModelStopConfirm
      onStop={stop}
      trigger={({ open, stopping }) => (
        <button
          type="button"
          onClick={open}
          disabled={stopping}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-(--err) hover:bg-(--err)/10 disabled:opacity-40"
          title="Stop model"
        >
          <Square className="h-3.5 w-3.5" fill="currentColor" />
          {stopping ? "Stopping" : "Stop"}
        </button>
      )}
    />
  );
}

function ActionBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className="h-7 rounded-full bg-(--fg)/5 px-3 text-[length:var(--fs-sm)] text-(--fg)/85 transition-colors hover:bg-(--fg)/10 hover:text-(--fg) disabled:cursor-not-allowed disabled:opacity-30"
    >
      {label}
    </button>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-(--border) px-2 py-[1px] text-[length:var(--fs-2xs)] font-medium text-(--dim)">
      {children}
    </span>
  );
}

function MetricCell({
  label,
  value,
  unit,
  detail,
}: {
  label: string;
  value: string;
  unit?: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 overflow-hidden">
      <dt className="truncate text-[length:var(--fs-xs)] text-(--dim)">{label}</dt>
      <dd className="mt-1 flex min-w-0 items-baseline gap-1 text-[length:var(--fs-lg)] font-semibold leading-none tabular-nums text-(--fg) sm:text-[length:var(--fs-2xl)]">
        <span className="truncate" title={value}>
          {value}
        </span>
        {unit ? (
          <span className="shrink-0 text-[length:var(--fs-xs)] text-(--dim)">{unit}</span>
        ) : null}
      </dd>
      {detail ? (
        <dd className="mt-1 min-w-0 truncate text-[length:var(--fs-xs)] tabular-nums text-(--dim)/75">
          {detail}
        </dd>
      ) : null}
    </div>
  );
}

function RuntimeStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="truncate">{label}</dt>
      <dd className="truncate tabular-nums text-(--fg)/85" title={value}>
        {value}
      </dd>
    </div>
  );
}

function healthDotClass(status: LinuxDashboardHealth): string {
  if (status === "critical") return "bg-(--err)";
  if (status === "warning") return "bg-(--hl3)";
  if (status === "ok") return "bg-(--hl2)";
  return "bg-(--dim)/55";
}
