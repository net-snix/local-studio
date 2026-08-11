"use client";

import type {
  LinuxDashboardAlert,
  LinuxDashboardDisk,
  LinuxDashboardHealth,
  LinuxDashboardService,
  LinuxDashboardSnapshot,
} from "@/lib/types";
import { alertClasses, formatBytes, formatPercent, serviceDot } from "./dashboard-format";

type BackendRuntimeSummary = {
  backends: Record<string, { installed: boolean; version?: string | null } | undefined>;
};

export function Meter({
  value,
  status = "ok",
  slim = false,
}: {
  value: number | null | undefined;
  status?: LinuxDashboardHealth;
  slim?: boolean;
}) {
  const width =
    typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  const color =
    status === "critical" ? "bg-(--err)" : status === "warning" ? "bg-(--hl3)" : "bg-(--fg)";
  return (
    <div className={`${slim ? "h-[2px]" : "h-[3px]"} overflow-hidden bg-(--dim)/15`}>
      <div className={`h-full ${color}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function Section({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-(--border)/45 pt-2.5">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-4 w-[2px] shrink-0 bg-(--fg)" />
          <h2 className="truncate font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-(--fg)/85">
            {title}
          </h2>
        </div>
        {meta ? (
          <div className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.16em] text-(--dim)/65">
            {meta}
          </div>
        ) : null}
      </div>
      <div className="pt-2">{children}</div>
    </section>
  );
}

export function AlertStrip({ alerts }: { alerts: LinuxDashboardAlert[] }) {
  if (alerts.length === 0) return null;

  return (
    <div className="fixed right-4 bottom-4 z-50 grid w-[min(28rem,calc(100vw-2rem))] gap-2">
      {alerts.slice(0, 4).map((alert) => (
        <div
          key={`${alert.source}-${alert.message}`}
          className={`flex items-center gap-2 border px-3 py-2 font-mono text-[10.5px] shadow-lg backdrop-blur ${alertClasses[alert.severity]}`}
        >
          <span className="h-1.5 w-1.5 shrink-0 bg-current" />
          <span className="min-w-0 truncate">{alert.message}</span>
        </div>
      ))}
    </div>
  );
}

const DISK_TITLES: Record<string, string> = {
  root: "system",
  models: "models",
  training: "training",
};

export function DisksTable({ disks }: { disks: LinuxDashboardDisk[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[300px] table-fixed text-left font-mono text-[10.5px]">
        <colgroup>
          <col className="w-[52%]" />
          <col className="w-[24%]" />
          <col className="w-[24%]" />
        </colgroup>
        <tbody>
          {disks.map((disk) => (
            <tr key={disk.path} className="border-b border-(--border)/25 last:border-b-0">
              <td className="py-1.5 pr-3 uppercase tracking-[0.08em] text-(--fg)/88">
                <div className="min-w-0">
                  <span className="inline-flex max-w-full min-w-0 items-center gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 ${healthDotClass(disk.status)}`} />
                    <span className="truncate">
                      {disk.device_model ?? DISK_TITLES[disk.label] ?? disk.label}
                    </span>
                  </span>
                </div>
              </td>
              <td className="py-1.5 pr-3 tabular-nums text-(--fg)/82">
                {formatBytes(disk.free_bytes)}
              </td>
              <td className="py-1.5 text-right tabular-nums text-(--dim)/75">
                <div className="ml-auto flex max-w-16 flex-col gap-1">
                  <span>{formatPercent(disk.used_percent)}</span>
                  <Meter value={disk.used_percent} status={disk.status} slim />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ServicesTable({ services }: { services: LinuxDashboardService[] }) {
  return (
    <MiniTable>
      {services.map((service) => (
        <MiniRow
          key={service.id}
          label={service.name}
          value={service.endpoint}
          extra={service.status}
          dotClass={serviceDot(service.status)}
          title={service.description}
        />
      ))}
    </MiniTable>
  );
}

export function BackendsTable({
  runtimeSummary,
  knownBackendIds,
  activeBackend,
}: {
  runtimeSummary?: BackendRuntimeSummary | null;
  knownBackendIds?: string[];
  activeBackend?: string | null;
}) {
  const rows = backendRows(runtimeSummary, knownBackendIds, activeBackend);

  if (rows.length === 0) {
    return <div className="font-mono text-[11px] text-(--dim)/65">No backend data yet.</div>;
  }

  return (
    <MiniTable>
      {rows.map((row) => (
        <MiniRow
          key={row.id}
          label={row.label}
          value={row.value}
          extra={row.extra}
          dotClass={row.dotClass}
        />
      ))}
    </MiniTable>
  );
}

export function ContainersTable({ data }: { data: LinuxDashboardSnapshot }) {
  if (data.docker_error) {
    return (
      <div className="border border-(--hl3)/35 bg-(--hl3)/5 px-3 py-2 font-mono text-[11px] leading-relaxed text-(--hl3)">
        Docker unavailable: {data.docker_error}
      </div>
    );
  }
  if (data.containers.length === 0) {
    return <div className="font-mono text-[11px] text-(--dim)/65">No running containers.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left font-mono text-[11px]">
        <thead className="uppercase tracking-[0.16em] text-(--dim)/55">
          <tr className="border-b border-(--border)/35">
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Image</th>
            <th className="py-2 font-medium">State</th>
            <th className="py-2 font-medium">Ports</th>
          </tr>
        </thead>
        <tbody>
          {data.containers.map((container) => (
            <tr key={container.id || container.name} className="border-b border-(--border)/25">
              <td className="max-w-[12rem] truncate py-2 text-(--fg)/82">{container.name}</td>
              <td className="max-w-[16rem] truncate py-2 text-(--dim)/65">{container.image}</td>
              <td className="py-2 text-(--fg)/75">{container.state || container.status}</td>
              <td className="max-w-[18rem] truncate py-2 text-(--dim)/65">
                {container.ports || "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Sensors({ data }: { data: LinuxDashboardSnapshot }) {
  const thermals = [...data.thermals].sort((a, b) => b.value_c - a.value_c).slice(0, 7);
  const fans = [...data.fans].sort((a, b) => b.rpm - a.rpm).slice(0, 7);
  const rows = [
    ...thermals.map((thermal, index) => ({
      key: `thermal-${thermal.chip}-${thermal.label}-${index}`,
      label: cleanSensorLabel(thermal.chip, thermal.label),
      value: `${Math.round(thermal.value_c)}°`,
    })),
    ...fans.map((fan, index) => ({
      key: `fan-${fan.chip}-${fan.label}-${index}`,
      label: cleanSensorLabel(fan.chip, fan.label),
      value: `${Math.round(fan.rpm)} rpm`,
    })),
  ].slice(0, 7);

  if (thermals.length === 0 && fans.length === 0) {
    return (
      <div className="font-mono text-[11px] text-(--dim)/65">
        No hwmon fan or thermal readings exposed.
      </div>
    );
  }

  return <SensorGroup title="readings" empty="No thermal sensors exposed." rows={rows} />;
}

function SensorGroup({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Array<{
    key: string;
    label: string;
    value: string;
  }>;
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <div className="sr-only">{title}</div>
      {rows.length === 0 ? (
        <div className="font-mono text-[11px] text-(--dim)/65">{empty}</div>
      ) : (
        <div>
          {rows.map((row) => (
            <div
              key={row.key}
              className="grid gap-1 border-b border-(--border)/25 py-1 last:border-b-0"
            >
              <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
                <span className="min-w-0 truncate text-(--dim)/70" title={row.label}>
                  {row.label}
                </span>
                <span className="tabular-nums text-(--fg)/82">{row.value}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div>{children}</div>
    </div>
  );
}

function MiniRow({
  label,
  value,
  extra,
  dotClass,
  title,
}: {
  label: string;
  value: string;
  extra: string;
  dotClass: string;
  title?: string;
}) {
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_3.75rem_5.25rem] items-baseline gap-2 border-b border-(--border)/25 py-[5px] font-mono text-[9.5px] last:border-b-0"
      title={title}
    >
      <div className="min-w-0 truncate uppercase tracking-[0.08em] text-(--fg)/82">{label}</div>
      <div className="truncate text-(--dim)/65">{value}</div>
      <div className="inline-flex min-w-0 items-center justify-end gap-1.5 text-(--dim)/65">
        <span className={`h-1.5 w-1.5 ${dotClass}`} />
        <span className="truncate">{extra}</span>
      </div>
    </div>
  );
}

function backendRows(
  runtimeSummary?: BackendRuntimeSummary | null,
  knownBackendIds?: string[],
  activeBackend?: string | null,
) {
  const backends = runtimeSummary
    ? Object.entries(runtimeSummary.backends).flatMap(([id, backend]) =>
        backend ? ([[id, backend]] as const) : [],
      )
    : [];
  const fallbackBackends = backends.length === 0 ? (knownBackendIds ?? []) : [];

  return [
    ...backends.map(([id, backend]) => {
      const running = activeBackend === id;
      const installed = backend.installed;
      return {
        id,
        label: id,
        value: backend.version ?? "version unknown",
        extra: running ? "active" : installed ? "installed" : "missing",
        dotClass: running ? "bg-(--hl2)" : installed ? "bg-(--hl2)" : "bg-(--dim)",
      };
    }),
    ...fallbackBackends.map((id) => {
      const running = activeBackend === id;
      return {
        id,
        label: id,
        value: "from recipes",
        extra: running ? "active" : "configured",
        dotClass: running ? "bg-(--hl2)" : "bg-(--dim)",
      };
    }),
  ];
}

function healthDotClass(status: LinuxDashboardHealth): string {
  if (status === "critical") return "bg-(--err)";
  if (status === "warning") return "bg-(--hl3)";
  if (status === "ok") return "bg-(--hl2)";
  return "bg-(--dim)/55";
}

function cleanSensorLabel(chip: string, label: string): string {
  const normalizedChip = chip.replace(/_/g, " ");
  const normalizedLabel = label.replace(/_/g, " ");
  return normalizedLabel.toLowerCase().startsWith(normalizedChip.toLowerCase())
    ? normalizedLabel
    : `${normalizedChip} / ${normalizedLabel}`;
}
