import { existsSync } from "node:fs";
import { realProcessRunner, type CommandResult } from "../../../core/command";
import type { DashboardDisk, LinuxDashboardHealth } from "./linux-dashboard-types";

const GIB = 1024 ** 3;

const roundOne = (value: number): number => Math.round(value * 10) / 10;

type DiskTarget = {
  path: string;
  label: string;
};

const DEFAULT_DISKS: DiskTarget[] = [{ path: "/", label: "root" }];

const runDashboardCommand = (command: string, args: string[], timeoutMs: number): CommandResult =>
  realProcessRunner.runSync(command, args, { timeoutMs });

type DiskIdentity = {
  device: string | null;
  device_model: string | null;
  device_size: string | null;
  filesystem: string | null;
  mountpoint: string | null;
};

const getFilesystemType = (pathValue: string): string | null => {
  const result = runDashboardCommand("findmnt", ["-T", pathValue, "-no", "FSTYPE"], 1_000);
  return result.status === 0 && result.stdout ? result.stdout.split("\n")[0]?.trim() || null : null;
};

const getMountIdentity = (pathValue: string): DiskIdentity => {
  const result = runDashboardCommand(
    "findmnt",
    ["-T", pathValue, "-no", "SOURCE,FSTYPE,TARGET"],
    1_000,
  );
  if (result.status !== 0 || !result.stdout) {
    return {
      device: null,
      device_model: null,
      device_size: null,
      filesystem: getFilesystemType(pathValue),
      mountpoint: null,
    };
  }

  const [device, filesystem, mountpoint] = result.stdout.trim().split(/\s+/, 3);
  const blockIdentity = getBlockIdentity(device);
  return {
    device: device || null,
    device_model: blockIdentity.device_model,
    device_size: blockIdentity.device_size,
    filesystem: filesystem || null,
    mountpoint: mountpoint || null,
  };
};

const getBlockIdentity = (
  source: string | undefined,
): Pick<DiskIdentity, "device_model" | "device_size"> => {
  if (!source?.startsWith("/dev/")) return { device_model: null, device_size: null };

  const parent = runDashboardCommand("lsblk", ["-no", "PKNAME", source], 1_000);
  const parentName = parent.status === 0 ? parent.stdout.split("\n")[0]?.trim() : "";
  const blockDevice = parentName ? `/dev/${parentName}` : source;
  const info = runDashboardCommand("lsblk", ["-dn", "-o", "MODEL,SIZE", blockDevice], 1_000);
  if (info.status !== 0 || !info.stdout) return { device_model: null, device_size: null };

  const parts = info.stdout.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { device_model: null, device_size: null };
  const deviceSize = parts.at(-1) ?? null;
  const deviceModel = parts.length > 1 ? parts.slice(0, -1).join(" ") : null;
  return {
    device_model: deviceModel,
    device_size: deviceSize,
  };
};

const collectDisk = (pathValue: string, label: string): DashboardDisk => {
  if (!existsSync(pathValue)) {
    return missingDisk(pathValue, label, "critical");
  }

  const result = runDashboardCommand("df", ["-P", "-k", pathValue], 1_500);
  if (result.status !== 0 || !result.stdout) {
    return missingDisk(pathValue, label, "unknown");
  }

  const line = result.stdout.split("\n").filter(Boolean).at(-1) ?? "";
  const parts = line.trim().split(/\s+/);
  const totalBytes = Number(parts[1] ?? 0) * 1024;
  const usedBytes = Number(parts[2] ?? 0) * 1024;
  const freeBytes = Number(parts[3] ?? 0) * 1024;
  const percent = totalBytes > 0 ? roundOne((usedBytes / totalBytes) * 100) : null;
  const identity = getMountIdentity(pathValue);

  return {
    path: pathValue,
    label,
    mounted: true,
    device: identity.device,
    device_model: identity.device_model,
    device_size: identity.device_size,
    filesystem: identity.filesystem,
    mountpoint: identity.mountpoint ?? parts[5] ?? pathValue,
    total_bytes: totalBytes,
    used_bytes: usedBytes,
    free_bytes: freeBytes,
    used_percent: percent,
    status: diskStatus(pathValue, label, freeBytes),
  };
};

export const collectDisks = (): DashboardDisk[] =>
  parseDiskTargets(process.env["VLLM_STUDIO_DASHBOARD_DISKS"]).map(({ path, label }) =>
    collectDisk(path, label),
  );

export function parseDiskTargets(value: string | undefined): DiskTarget[] {
  if (!value?.trim()) return DEFAULT_DISKS;

  const targets = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      if (separator === -1) {
        return {
          path: entry,
          label: entry === "/" ? "root" : (entry.split("/").filter(Boolean).at(-1) ?? entry),
        };
      }

      const label = entry.slice(0, separator).trim();
      const pathValue = entry.slice(separator + 1).trim();
      return { path: pathValue, label: label || pathValue };
    })
    .filter(({ path }) => path.startsWith("/"));

  return targets.length > 0 ? targets : DEFAULT_DISKS;
}

function missingDisk(
  pathValue: string,
  label: string,
  status: LinuxDashboardHealth,
): DashboardDisk {
  return {
    path: pathValue,
    label,
    mounted: false,
    device: null,
    device_model: null,
    device_size: null,
    filesystem: null,
    mountpoint: null,
    total_bytes: 0,
    used_bytes: 0,
    free_bytes: 0,
    used_percent: null,
    status,
  };
}

function diskStatus(pathValue: string, label: string, freeBytes: number): LinuxDashboardHealth {
  if (label === "root" && freeBytes < 20 * GIB) return "critical";
  if (label === "root" && freeBytes < 40 * GIB) return "warning";
  if (label === "models" && freeBytes < 100 * GIB) return "critical";
  if (label === "models" && freeBytes < 200 * GIB) return "warning";
  if (label === "training" && freeBytes < 50 * GIB) return "critical";
  if (label === "training" && freeBytes < 100 * GIB) return "warning";
  return "ok";
}
