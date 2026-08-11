"use client";

import { useRef, useState } from "react";
import { ChevronDown, Square } from "lucide-react";
import { ModelStopConfirm } from "@/features/dashboard/model-stop-confirm";
import type { DashboardLayoutProps } from "@/features/dashboard/layout/dashboard-types";
import { useModelLifecycle } from "@/features/dashboard/use-model-lifecycle";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { LinuxDashboardHealth, RecipeWithStatus } from "@/lib/types";
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
    <section className="mb-2 px-1 pt-1 pb-2">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] tracking-[0.04em]">
            <span className={`h-1.5 w-1.5 ${healthDotClass(healthStatus)}`} />
            <span className="font-medium uppercase tracking-[0.16em] text-(--dim)">
              {healthStatus === "ok" ? "Active" : healthStatus}
            </span>
            <RuntimeTag>linux</RuntimeTag>
            {runtime.backend ? <RuntimeTag>{runtime.backend}</RuntimeTag> : null}
            {runtime.platform ? <RuntimeTag>{runtime.platform}</RuntimeTag> : null}
            {runtime.port ? (
              <span className="font-mono text-[10px] tabular-nums text-(--dim)/70">
                :{runtime.port}
              </span>
            ) : null}
          </div>
          <h2
            className="mt-1.5 min-w-0 text-[20px] font-semibold leading-tight text-(--fg) sm:text-[22px]"
            title={title}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 break-words">{hostLabel}</span>
              <span aria-hidden="true" className="h-4 w-px shrink-0 bg-(--fg)/35" />
              <span className="min-w-0 break-words">{runtime.modelName}</span>
            </span>
          </h2>
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
          <RuntimeButton label="Logs" onClick={statusData.onNavigateLogs} />
          <RuntimeButton
            label={statusData.benchmarking ? "Run" : "Bench"}
            onClick={statusData.onBenchmark}
            disabled={!runtime.controllable || statusData.benchmarking}
          />
          {trailingControls}
        </div>
      </div>

      <dl className="status-metric-strip mt-5 grid w-full grid-cols-1 border-b border-(--border)/40 pb-5 sm:grid-cols-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.9fr)_minmax(0,1.08fr)_minmax(0,0.5fr)_minmax(0,0.78fr)_minmax(0,0.82fr)_minmax(0,0.82fr)_minmax(0,0.62fr)]">
        <HeroMetric
          label="Decode"
          value={runtime.decode}
          unit="tok/s"
          detail={runtime.decodePeak}
        />
        <HeroMetric label="TTFT" value={runtime.ttft} unit="ms" detail={runtime.ttftPeak} />
        <HeroMetric
          label="Prefill"
          value={runtime.prefill}
          unit="t/s"
          detail={runtime.prefillPeak}
        />
        <CompactMetric label="Req" value={runtime.requests} />
        <CompactMetric label="VRAM" value={runtime.vram} />
        <CompactMetric label="GPU Power" value={runtime.power} />
        <CompactMetric label="System Power" value={hostSummary?.power ?? "n/a"} />
        <CompactMetric label="Uptime" value={hostSummary?.uptime ?? "n/a"} />
      </dl>

      <dl className="mt-2 grid gap-x-3 gap-y-1 font-mono text-[10.5px] text-(--dim) sm:grid-cols-2 xl:grid-cols-4">
        <RuntimeStat label="Total tokens" value={runtime.totalTokens} />
        <RuntimeStat label="Prompt tokens" value={runtime.promptTokens} />
        <RuntimeStat label="Completion tokens" value={runtime.completionTokens} />
        <RuntimeStat label="Duration" value={runtime.duration} />
      </dl>
    </section>
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
          className="inline-flex h-8 items-center gap-1.5 rounded-[3px] px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-(--err) hover:bg-(--err)/10 disabled:opacity-40"
          title="Stop model"
        >
          <Square className="h-3 w-3" fill="currentColor" />
          {stopping ? "Stopping" : "Stop"}
        </button>
      )}
    />
  );
}

function ModelsDropdown({
  recipes,
  currentRecipeId,
  lifecycleStatus,
  onLaunch,
  onNewRecipe,
  onViewAll,
}: {
  recipes: RecipeWithStatus[];
  currentRecipeId?: string;
  lifecycleStatus: DashboardLayoutProps["lifecycleStatus"];
  onLaunch: (id: string) => Promise<void>;
  onNewRecipe?: () => void;
  onViewAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useMountSubscription(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const query = filter.trim().toLowerCase();
  const filtered = query
    ? recipes.filter(
        (recipe) =>
          recipe.name.toLowerCase().includes(query) || recipe.id.toLowerCase().includes(query),
      )
    : recipes;
  const visible = filtered.slice(0, query ? 8 : 6);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 items-center gap-1.5 rounded-[3px] border border-(--border)/70 px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-(--fg) hover:border-(--border) hover:bg-(--fg)/5"
      >
        Models
        <ChevronDown className="h-3 w-3" />
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-[4px] border border-(--border) bg-(--surface) shadow-lg">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b border-(--border)">
            <input
              autoFocus
              type="text"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search models"
              className="min-w-0 bg-transparent px-2.5 py-1.5 font-mono text-xs text-(--fg) placeholder:text-(--dim)/60 focus:outline-none"
            />
            {onNewRecipe ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onNewRecipe();
                }}
                className="border-l border-(--border) px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-(--dim) hover:bg-(--fg)/5 hover:text-(--fg)"
              >
                New
              </button>
            ) : null}
          </div>
          <div className="max-h-[18rem] overflow-auto">
            {visible.length === 0 ? (
              <div className="px-2.5 py-2 font-mono text-[10.5px] text-(--dim)">
                No models found.
              </div>
            ) : null}
            {visible.map((recipe) => {
              const current = recipe.id === currentRecipeId;
              const running = recipe.status === "running";
              const disabled = lifecycleStatus === "starting" || current;
              return (
                <button
                  key={recipe.id}
                  type="button"
                  disabled={disabled}
                  onClick={async () => {
                    setOpen(false);
                    await onLaunch(recipe.id);
                  }}
                  className={`flex w-full items-center gap-2 border-b border-(--border)/60 px-2.5 py-1.5 text-left last:border-b-0 ${current ? "bg-(--fg)/8" : "hover:bg-(--fg)/5"} ${disabled && !current ? "cursor-not-allowed opacity-30" : ""}`}
                >
                  <span
                    className={`h-3 w-0.5 shrink-0 ${current ? "bg-(--fg)" : running ? "bg-(--hl2)" : "bg-(--dim)/40"}`}
                  />
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-xs text-(--fg)"
                    title={recipe.name}
                  >
                    {recipe.name}
                  </span>
                  {running ? <span className="h-1.5 w-1.5 bg-(--hl2)" /> : null}
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-(--dim)">
                    tp{recipe.tp || recipe.tensor_parallel_size}
                  </span>
                </button>
              );
            })}
          </div>
          {onViewAll && filtered.length > visible.length ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onViewAll();
              }}
              className="block w-full border-t border-(--border) px-2.5 py-1.5 text-left font-mono text-[10px] text-(--dim) hover:bg-(--fg)/5 hover:text-(--fg)"
            >
              {query ? `${filtered.length - visible.length} more` : `View all ${recipes.length}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RuntimeButton({
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
      className="inline-flex h-8 items-center rounded-[3px] border border-(--border)/70 px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-(--dim) hover:border-(--border) hover:bg-(--fg)/5 hover:text-(--fg) disabled:cursor-not-allowed disabled:opacity-30"
    >
      {label}
    </button>
  );
}

function RuntimeTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="border border-(--border)/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-(--dim)/80">
      {children}
    </span>
  );
}

function HeroMetric({
  label,
  value,
  unit,
  detail,
}: {
  label: string;
  value: string | null;
  unit: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 overflow-hidden border-b border-(--border)/30 py-2 sm:border-r sm:border-b-0 sm:px-3 sm:first:pl-0 xl:px-5 xl:first:pl-0 xl:last:border-r-0">
      <dt className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-(--dim)">
        {label}
      </dt>
      <dd className="mt-2 flex min-w-0 items-baseline gap-1.5 font-mono tabular-nums">
        <span className="min-w-0 truncate text-[30px] font-light leading-none text-(--fg)">
          {value ?? "0"}
        </span>
        {value ? <span className="shrink-0 text-[11px] text-(--dim)">{unit}</span> : null}
      </dd>
      <div className="mt-1 min-h-[0.9rem] truncate font-mono text-[10.5px] tabular-nums text-(--dim)">
        {detail ?? "\u00a0"}
      </div>
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 overflow-hidden border-b border-(--border)/30 py-2 font-mono tabular-nums sm:border-r sm:border-b-0 sm:px-3 xl:px-4 xl:last:border-r-0">
      <dt className="truncate text-[9.5px] uppercase tracking-[0.14em] text-(--dim)">{label}</dt>
      <dd
        className="mt-4 truncate text-[13px] leading-none text-(--fg)/90"
        title={value ?? undefined}
      >
        {value ?? "0"}
      </dd>
    </div>
  );
}

function RuntimeStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="truncate uppercase tracking-[0.12em]">{label}</dt>
      <dd className="truncate text-(--fg)" title={value}>
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
