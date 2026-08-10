import type { LinuxDashboardGpu, LinuxDashboardHealth, LinuxDashboardSnapshot } from "@/lib/types";
import { formatBytes, formatPercent, formatTemp } from "./dashboard-format";
import {
  getCpuUsageSamples,
  getGpuUsageSamples,
  type DashboardHistoryPoint,
  type DashboardUsageSample,
} from "./dashboard-history";
import { Meter, Section } from "./dashboard-system-sections";

const CHART_WIDTH = 360;
const CHART_HEIGHT = 96;
const CHART_PAD = 6;
const CHART_WINDOW_MS = 5 * 60 * 1000;
const COMPACT_CHART_WINDOW_MS = 60 * 1000;

type ChartPoint = {
  x: number;
  y: number;
};

type ChartScale = "percent" | "active";

const latestNumber = (values: Array<number | null | undefined>): number | null => {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
};

const latestSampleTime = (samples: DashboardUsageSample[]): number | null => {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const time = samples[index]?.time;
    if (typeof time === "number" && Number.isFinite(time)) return time;
  }
  return null;
};

const samplesInWindow = (
  samples: DashboardUsageSample[],
  windowMs: number,
): DashboardUsageSample[] => {
  const end = latestSampleTime(samples);
  if (end == null) return [];
  const start = end - windowMs;
  return samples.filter((sample) => sample.time >= start && sample.time <= end);
};

const chartScaleMax = (samples: DashboardUsageSample[], scale: ChartScale): number => {
  if (scale === "percent") return 100;
  const values = samples
    .map((sample) => sample.value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const peak = values.length > 0 ? Math.max(...values) : 0;
  if (peak <= 10) return 10;
  if (peak <= 25) return 25;
  if (peak <= 50) return 50;
  if (peak <= 100) return 100;
  if (peak <= 250) return 250;
  if (peak <= 500) return 500;
  if (peak <= 1000) return 1000;
  return Math.ceil(peak / 500) * 500;
};

const toChartPoints = (
  samples: DashboardUsageSample[],
  scaleMax: number,
  windowMs: number,
): ChartPoint[] => {
  const visibleSamples = samples.flatMap((sample): Array<{ time: number; value: number }> => {
    if (
      typeof sample.value !== "number" ||
      !Number.isFinite(sample.value) ||
      !Number.isFinite(sample.time)
    ) {
      return [];
    }
    return [{ time: sample.time, value: sample.value }];
  });
  const first = visibleSamples[0];
  const last = visibleSamples.at(-1);
  if (!first || !last) return [];
  const elapsed = last.time - first.time;
  const start = elapsed >= windowMs ? last.time - windowMs : first.time;
  const end = start + windowMs;
  const timeSpan = Math.max(end - start, 1);

  return visibleSamples.flatMap((sample): ChartPoint[] => {
    const value = sample.value;
    const x = CHART_PAD + ((sample.time - start) / timeSpan) * (CHART_WIDTH - CHART_PAD * 2);
    const y =
      CHART_PAD +
      ((scaleMax - Math.min(scaleMax, Math.max(0, value))) / scaleMax) *
        (CHART_HEIGHT - CHART_PAD * 2);
    return [{ x, y }];
  });
};

const buildLinePath = (points: ChartPoint[]): string => {
  if (points.length < 2) return "";
  const [first, ...rest] = points;
  return rest.reduce((path, point) => `${path} L ${point.x} ${point.y}`, `M ${first.x} ${first.y}`);
};

function UsageLineChart({
  samples,
  stroke = "var(--fg)",
  muted = false,
  scale = "percent",
  windowMs = CHART_WINDOW_MS,
}: {
  samples: DashboardUsageSample[];
  stroke?: string;
  muted?: boolean;
  scale?: ChartScale;
  windowMs?: number;
}) {
  const visibleSamples = samplesInWindow(samples, windowMs);
  const scaleMax = chartScaleMax(visibleSamples, scale);
  const points = toChartPoints(visibleSamples, scaleMax, windowMs);
  const linePath = buildLinePath(points);

  return (
    <svg
      role="img"
      aria-label="Usage history graph"
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="h-full min-h-0 w-full overflow-visible"
      preserveAspectRatio="none"
    >
      {[25, 50, 75].map((mark) => {
        const value = (mark / 100) * scaleMax;
        const y = CHART_PAD + ((scaleMax - value) / scaleMax) * (CHART_HEIGHT - CHART_PAD * 2);
        return (
          <line
            key={mark}
            x1={0}
            x2={CHART_WIDTH}
            y1={y}
            y2={y}
            stroke="var(--border)"
            strokeOpacity="0.35"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        );
      })}
      {linePath ? (
        <path
          d={linePath}
          fill="none"
          stroke={stroke}
          strokeLinecap="square"
          strokeLinejoin="miter"
          strokeOpacity={muted ? 0.34 : 0.78}
          strokeWidth={muted ? 1.4 : 2.1}
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        <text x="50%" y="50%" textAnchor="middle" className="fill-(--dim) text-[10px]">
          collecting samples
        </text>
      )}
    </svg>
  );
}

function DashboardSparkline({
  samples,
  stroke = "var(--fg)",
  dotted = false,
  scale = "active",
}: {
  samples: DashboardUsageSample[];
  stroke?: string;
  dotted?: boolean;
  scale?: ChartScale;
}) {
  const visibleSamples = samplesInWindow(samples, COMPACT_CHART_WINDOW_MS);
  const scaleMax = chartScaleMax(visibleSamples, scale);
  const points = toChartPoints(visibleSamples, scaleMax, COMPACT_CHART_WINDOW_MS);
  const linePath = buildLinePath(points);

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="h-8 w-full overflow-visible"
      preserveAspectRatio="none"
    >
      {dotted ? (
        <line
          x1={CHART_PAD}
          x2={CHART_WIDTH - CHART_PAD}
          y1={CHART_HEIGHT / 2}
          y2={CHART_HEIGHT / 2}
          stroke="var(--dim)"
          strokeDasharray="2 8"
          strokeLinecap="square"
          strokeOpacity="0.55"
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
        />
      ) : linePath ? (
        <path
          d={linePath}
          fill="none"
          stroke={stroke}
          strokeLinecap="square"
          strokeLinejoin="miter"
          strokeOpacity="0.92"
          strokeWidth="1.8"
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        <line
          x1={CHART_PAD}
          x2={CHART_WIDTH - CHART_PAD}
          y1={CHART_HEIGHT / 2}
          y2={CHART_HEIGHT / 2}
          stroke={stroke}
          strokeOpacity="0.6"
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

export function SystemOverview({
  data,
  history,
}: {
  data: LinuxDashboardSnapshot;
  history: DashboardHistoryPoint[];
  status: LinuxDashboardHealth;
}) {
  const cpuSamples = getCpuUsageSamples(history);
  const cpuCurrent =
    latestNumber(cpuSamples.map((sample) => sample.value)) ??
    data.cpu.usage_percent ??
    data.cpu.load_percent_1m;
  const memorySamples = history.map((point) => ({
    time: point.time,
    value: point.memory_used_percent,
  }));

  return (
    <Section title="Host telemetry" meta="last 60 seconds">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)]">
        <TrendPanel title="CPU usage" value={formatPercent(cpuCurrent)} size="large">
          <UsageLineChart
            samples={cpuSamples}
            stroke="var(--fg)"
            windowMs={COMPACT_CHART_WINDOW_MS}
          />
        </TrendPanel>
        <div className="hidden bg-(--border)/55 lg:block" />
        <TrendPanel
          title="Memory"
          value={formatPercent(data.memory.used_percent)}
          detail={`${formatBytes(data.memory.used_bytes)} / ${formatBytes(data.memory.total_bytes)}`}
          size="large"
        >
          <UsageLineChart
            samples={memorySamples}
            stroke="var(--fg)"
            windowMs={COMPACT_CHART_WINDOW_MS}
          />
        </TrendPanel>
      </div>
    </Section>
  );
}

export function GpuTelemetry({
  data,
  history,
}: {
  data: LinuxDashboardSnapshot;
  history: DashboardHistoryPoint[];
}) {
  const sortedGpus = [...data.gpus].sort((a, b) => b.memory_total_bytes - a.memory_total_bytes);

  return (
    <Section title="GPUs">
      {sortedGpus.length > 0 ? (
        <div className="space-y-2.5">
          <div className="grid gap-2.5 lg:grid-cols-2">
            {sortedGpus.map((gpu) => (
              <GpuUsageGraph
                key={`${gpu.index}-${gpu.uuid ?? gpu.name}`}
                gpu={gpu}
                history={history}
              />
            ))}
          </div>

          <GpuListTable gpus={sortedGpus} />
        </div>
      ) : (
        <div className="font-mono text-[11px] text-(--dim)/65">No GPU telemetry available.</div>
      )}
    </Section>
  );
}

function GpuUsageGraph({
  gpu,
  history,
}: {
  gpu: LinuxDashboardGpu;
  history: DashboardHistoryPoint[];
}) {
  const samples = getGpuUsageSamples(history, gpu);

  return (
    <div className="min-w-0 border-t border-(--border)/30 pt-2 font-mono">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[10.5px] text-(--fg)/82" title={gpu.name}>
            G{gpu.index} <span className="text-(--dim)/60">{gpu.name}</span>
          </div>
        </div>
        <div className="shrink-0 text-[12px] tabular-nums text-(--fg)/85">
          {formatPercent(gpu.utilization_percent)}
        </div>
      </div>
      <div className="h-24">
        <UsageLineChart samples={samples} stroke="var(--fg)" windowMs={COMPACT_CHART_WINDOW_MS} />
      </div>
    </div>
  );
}

function TrendPanel({
  title,
  value,
  detail,
  children,
  size = "normal",
}: {
  title: string;
  value: string;
  detail?: string;
  children: React.ReactNode;
  size?: "normal" | "large";
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-(--dim)/70">
            {title}
          </div>
          {detail ? (
            <div className="mt-1 truncate font-mono text-[11px] text-(--dim)/55">{detail}</div>
          ) : null}
        </div>
        <div className="font-mono text-[12px] tabular-nums text-(--fg)/82">{value}</div>
      </div>
      <div className={size === "large" ? "h-24" : "h-[4.8rem]"}>{children}</div>
    </div>
  );
}

function GpuListTable({ gpus }: { gpus: LinuxDashboardGpu[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] table-fixed font-mono text-[10.5px]">
        <colgroup>
          <col className="w-[34%]" />
          <col className="w-[28%]" />
          <col className="w-[7%]" />
          <col className="w-[7%]" />
          <col className="w-[9%]" />
          <col className="w-[6%]" />
          <col className="w-[9%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-(--border)/35 uppercase tracking-[0.16em] text-(--dim)/55">
            {(
              [
                ["GPU", "pr-6 text-left"],
                ["VRAM", "px-6 text-left"],
                ["Util", "px-4 text-right"],
                ["Temp", "px-4 text-right"],
                ["VRAM Temp", "px-4 text-right"],
                ["Fan", "px-4 text-right"],
                ["Power", "pl-4 text-right"],
              ] as const
            ).map(([heading, alignClass]) => (
              <th key={heading} className={`py-1.5 font-medium ${alignClass}`}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {gpus.map((gpu) => (
            <GpuMemoryRow key={`${gpu.index}-${gpu.uuid ?? gpu.name}`} gpu={gpu} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GpuMemoryRow({ gpu }: { gpu: LinuxDashboardGpu }) {
  return (
    <tr className="border-b border-(--border)/25 last:border-b-0">
      <td className="py-[5px] pr-6 text-(--fg)/82" title={gpu.name}>
        <span className="block truncate">
          G{gpu.index} <span className="text-(--dim)/55">{gpu.name}</span>
        </span>
      </td>
      <td className="px-6 py-[5px]">
        <div className="grid grid-cols-[minmax(6rem,1fr)_4.75rem] items-center gap-4">
          <div className="h-[2px] bg-(--dim)/15">
            <div
              className="h-full bg-(--fg)/45"
              style={{ width: `${gpu.memory_used_percent ?? 0}%` }}
            />
          </div>
          <span className="whitespace-nowrap text-right tabular-nums text-(--fg)/78">
            {formatGpuGb(gpu.memory_used_bytes)}
            <span className="text-(--dim)/55">/{formatGpuGb(gpu.memory_total_bytes)}</span>
          </span>
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-[5px] text-right tabular-nums text-(--fg)/78">
        {formatPercent(gpu.utilization_percent)}
      </td>
      <td className="whitespace-nowrap px-4 py-[5px] text-right tabular-nums text-(--fg)/78">
        {formatTemp(gpu.temperature_c)}
      </td>
      <td className="whitespace-nowrap px-4 py-[5px] text-right tabular-nums text-(--fg)/78">
        <UnavailableValue
          value={formatTemp(gpu.memory_temperature_c)}
          unavailableReason={
            gpu.memory_temperature_c === null ? gpu.memory_temperature_unavailable_reason : null
          }
        />
      </td>
      <td className="whitespace-nowrap px-4 py-[5px] text-right tabular-nums text-(--fg)/78">
        {formatPercent(gpu.fan_percent)}
      </td>
      <td className="whitespace-nowrap py-[5px] pl-4 text-right tabular-nums text-(--fg)/78">
        <GpuPowerValue drawWatts={gpu.power_draw_watts} limitWatts={gpu.power_limit_watts} />
      </td>
    </tr>
  );
}

function GpuPowerValue({
  drawWatts,
  limitWatts,
}: {
  drawWatts: number | null | undefined;
  limitWatts: number | null | undefined;
}) {
  const draw =
    typeof drawWatts === "number" && Number.isFinite(drawWatts)
      ? `${Math.round(drawWatts)}`
      : "n/a";
  if (typeof limitWatts !== "number" || !Number.isFinite(limitWatts) || limitWatts <= 0) {
    return <>{draw === "n/a" ? draw : `${draw}W`}</>;
  }

  return (
    <>
      {draw === "n/a" ? draw : `${draw}W`}
      <span className="text-(--dim)/55">/{Math.round(limitWatts)}W</span>
    </>
  );
}

function UnavailableValue({
  value,
  unavailableReason,
}: {
  value: string;
  unavailableReason?: string | null;
}) {
  return (
    <span
      className={
        unavailableReason
          ? "cursor-help underline decoration-(--dim)/35 underline-offset-4"
          : undefined
      }
      title={unavailableReason || undefined}
    >
      {value}
    </span>
  );
}

export function formatGpuGb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0G";
  const gb = bytes / 1024 ** 3;
  return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)}G`;
}

export function formatGpuPower(
  drawWatts: number | null | undefined,
  limitWatts: number | null | undefined,
): string {
  const current =
    typeof drawWatts === "number" && Number.isFinite(drawWatts) ? Math.round(drawWatts) : null;
  if (typeof limitWatts !== "number" || !Number.isFinite(limitWatts) || limitWatts <= 0) {
    return current == null ? "n/a" : `${current}W`;
  }
  const limit = Math.round(limitWatts);
  return current == null ? `n/a/${limit}W` : `${current}/${limit}W`;
}

function formatCpuTopology(data: LinuxDashboardSnapshot): string {
  const physicalCores = data.host.cpu_physical_cores || data.cpu.cores;
  const threads = data.host.cpu_threads || data.cpu.cores;
  return `${physicalCores} cores / ${threads} threads`;
}
