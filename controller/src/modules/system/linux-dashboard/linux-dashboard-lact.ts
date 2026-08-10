import { realProcessRunner, resolveBinary, type CommandResult } from "../../../core/command";

export type LactMemoryTemperature = {
  value: number | null;
  unavailableReason: string | null;
};

export type LactMemoryTemperatureLookup = {
  unavailableReason: string | null;
  byPciBus: Map<string, LactMemoryTemperature>;
};

type LactGpuEntry = {
  lactIndex: number;
  pciBusId: string;
};

const LACT_TIMEOUT_MS = 2_000;
const LACT_CACHE_TTL_MS = 5_000;
let lactCache: { value: LactMemoryTemperatureLookup; collectedAt: number } | null = null;

const runDashboardCommand = (command: string, args: string[], timeoutMs: number): CommandResult =>
  realProcessRunner.runSync(command, args, { timeoutMs });

export const normalizePciBusId = (pciBusId: string | null | undefined): string | null => {
  if (!pciBusId) return null;
  const match = pciBusId
    .trim()
    .toLowerCase()
    .match(/([0-9a-f]{2}:[0-9a-f]{2}\.[0-9a-f])$/);
  return match?.[1] ?? null;
};

export const parseLactGpuList = (stdout: string): LactGpuEntry[] =>
  stdout
    .split("\n")
    .map((line) => {
      const match = line.match(
        /^(\d+):\s+.*-([0-9a-fA-F]{4}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.[0-9a-fA-F])\s+\(/,
      );
      const pciBusId = normalizePciBusId(match?.[2]);
      if (!match || !pciBusId) return null;
      return {
        lactIndex: Number(match[1]),
        pciBusId,
      };
    })
    .filter((entry): entry is LactGpuEntry => entry !== null && Number.isFinite(entry.lactIndex));

export const parseLactVramTemperature = (stdout: string): number | null => {
  const match = stdout.match(/\bVRAM:\s*(-?\d+(?:\.\d+)?)\s*°?\s*C\b/i);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

const commandFailureReason = (prefix: string, stderr: string, stdout: string): string => {
  const detail = stderr.trim() || stdout.trim();
  return detail ? `${prefix}: ${detail.split("\n")[0]}` : prefix;
};

const collectLactMemoryTemperaturesUncached = (): LactMemoryTemperatureLookup => {
  const lact = resolveBinary("lact");
  if (!lact) {
    return {
      unavailableReason: "LACT is not installed.",
      byPciBus: new Map(),
    };
  }

  const listResult = runDashboardCommand(lact, ["cli", "list"], LACT_TIMEOUT_MS);
  if (listResult.status !== 0) {
    return {
      unavailableReason: commandFailureReason(
        "LACT GPU list failed",
        listResult.stderr,
        listResult.stdout,
      ),
      byPciBus: new Map(),
    };
  }

  const entries = parseLactGpuList(listResult.stdout);
  const byPciBus = new Map<string, LactMemoryTemperature>();

  for (const entry of entries) {
    const statsResult = runDashboardCommand(
      lact,
      ["cli", "-g", String(entry.lactIndex), "stats"],
      LACT_TIMEOUT_MS,
    );
    if (statsResult.status !== 0) {
      byPciBus.set(entry.pciBusId, {
        value: null,
        unavailableReason: commandFailureReason(
          "LACT GPU stats failed",
          statsResult.stderr,
          statsResult.stdout,
        ),
      });
      continue;
    }

    const value = parseLactVramTemperature(statsResult.stdout);
    byPciBus.set(entry.pciBusId, {
      value,
      unavailableReason:
        value === null ? "LACT did not report VRAM temperature for this GPU." : null,
    });
  }

  return {
    unavailableReason: null,
    byPciBus,
  };
};

export const collectLactMemoryTemperatures = (): LactMemoryTemperatureLookup => {
  const now = Date.now();
  if (lactCache && now - lactCache.collectedAt < LACT_CACHE_TTL_MS) {
    return lactCache.value;
  }

  const value = collectLactMemoryTemperaturesUncached();
  lactCache = { value, collectedAt: now };
  return value;
};
