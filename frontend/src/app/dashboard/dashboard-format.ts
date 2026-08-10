import type { LinuxDashboardAlert, LinuxDashboardHealth, LinuxDashboardService } from "@/lib/types";

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
};

export const formatPercent = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "n/a";

const formatWatts = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)} W` : "n/a";

export const formatTemp = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}°` : "n/a";

export const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const healthClasses: Record<LinuxDashboardHealth, string> = {
  ok: "border-(--fg)/20 text-(--fg)/70 bg-(--fg)/5",
  warning: "border-(--hl3)/40 text-(--hl3) bg-(--hl3)/10",
  critical: "border-(--err)/40 text-(--err) bg-(--err)/10",
  unknown: "border-(--border) text-(--dim) bg-(--bg)",
};

export const alertClasses: Record<LinuxDashboardAlert["severity"], string> = {
  info: "border-(--border) text-(--dim) bg-(--bg)",
  warning: "border-(--hl3)/40 text-(--hl3) bg-(--hl3)/10",
  critical: "border-(--err)/40 text-(--err) bg-(--err)/10",
};

export const serviceDot = (status: LinuxDashboardService["status"]): string =>
  status === "running" ? "bg-(--hl2)" : "bg-(--dim)";
