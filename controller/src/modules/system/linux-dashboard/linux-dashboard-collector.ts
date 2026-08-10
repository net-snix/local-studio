import { connect } from "node:net";
import { arch, cpus, hostname, loadavg, platform, release, totalmem, uptime } from "node:os";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Effect } from "effect";
import type { AppContext } from "../../../app-context";
import { realProcessRunner, type CommandResult } from "../../../core/command";
import { getGpuInfo } from "../platform/gpu";
import { resolveNvidiaSmiBinary } from "../platform/smi-tools";
import { collectDisks } from "./linux-dashboard-disks";
import { collectLactMemoryTemperatures, normalizePciBusId } from "./linux-dashboard-lact";
import type {
  DashboardAlert,
  DashboardContainer,
  DashboardFan,
  DashboardGpu,
  DashboardService,
  DashboardThermal,
  LinuxDashboardAlertSeverity,
  LinuxDashboardHealth,
  LinuxDashboardSnapshot,
} from "./linux-dashboard-types";

const readText = (pathValue: string): string | null => {
  try {
    return readFileSync(pathValue, "utf-8").trim();
  } catch {
    return null;
  }
};

const toNumber = (value: string | undefined): number | null => {
  if (!value) return null;
  const cleaned = value
    .replace(/\[[^\]]+\]/g, "")
    .replace(/[^\d.+-]/g, "")
    .trim();
  if (!cleaned || cleaned.toLowerCase() === "nan") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

const roundOne = (value: number): number => Math.round(value * 10) / 10;

type DashboardCommandRunner = (command: string, args: string[], timeoutMs: number) => CommandResult;

const runDashboardCommand: DashboardCommandRunner = (command, args, timeoutMs) =>
  realProcessRunner.runSync(command, args, { timeoutMs });

const SLOW_SNAPSHOT_TTL_MS = 30_000;
const DEFAULT_CPU_POWER_SAMPLE_TTL_MS = 60_000;
export const parseCpuPowerSampleTtl = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const CPU_POWER_SAMPLE_TTL_MS = parseCpuPowerSampleTtl(
  process.env["VLLM_STUDIO_CPU_POWER_SAMPLE_TTL_MS"],
  DEFAULT_CPU_POWER_SAMPLE_TTL_MS,
);
const CPU_ENERGY_HELPER =
  process.env["VLLM_STUDIO_CPU_ENERGY_HELPER"] ?? "/usr/local/libexec/vllm-studio/read-cpu-energy";

type CpuSample = {
  idle: number;
  total: number;
};

type CpuEnergySample = {
  energyMicrojoules: number;
  maxEnergyRangeMicrojoules: number | null;
};

type CpuIdentity = {
  model: string | null;
  physicalCores: number;
  threads: number;
};

export const parseCpuInfoIdentity = (
  cpuinfo: string,
  fallbackModel: string | null,
  threads: number,
): CpuIdentity => {
  const entries = cpuinfo.split(/\n\s*\n/).map((entry) =>
    Object.fromEntries(
      entry
        .split("\n")
        .map((line) => line.split(":", 2).map((part) => part.trim()))
        .filter((parts): parts is [string, string] => Boolean(parts[0]) && parts[1] !== undefined),
    ),
  );
  const model =
    entries.find((entry) => entry["model name"])?.["model name"] ||
    entries.find((entry) => entry["Hardware"])?.["Hardware"] ||
    fallbackModel;
  const coreIds = new Set<string>();
  const physicalIds = new Set<string>();

  for (const entry of entries) {
    const physicalId = entry["physical id"] ?? "0";
    const coreId = entry["core id"];
    if (entry["physical id"] !== undefined) physicalIds.add(physicalId);
    if (coreId !== undefined) coreIds.add(`${physicalId}:${coreId}`);
  }

  const cpuCoresPerSocket = Number(entries.find((entry) => entry["cpu cores"])?.["cpu cores"]);
  const socketCount = Math.max(physicalIds.size, 1);
  const physicalCores =
    coreIds.size > 0
      ? coreIds.size
      : Number.isFinite(cpuCoresPerSocket) && cpuCoresPerSocket > 0
        ? cpuCoresPerSocket * socketCount
        : threads;

  return {
    model: model ?? null,
    physicalCores,
    threads,
  };
};

const collectCpuIdentity = (): CpuIdentity => {
  const cpuList = cpus();
  const threads = cpuList.length || 1;
  const fallbackModel = cpuList.find((cpu) => cpu.model.trim())?.model.trim() || null;
  const cpuinfo = readText("/proc/cpuinfo");
  if (!cpuinfo) {
    return {
      model: fallbackModel,
      physicalCores: threads,
      threads,
    };
  }

  return parseCpuInfoIdentity(cpuinfo, fallbackModel, threads);
};

const readCpuSample = (): CpuSample | null => {
  const stat = readText("/proc/stat");
  if (!stat) return null;
  const line = stat.split("\n")[0];
  if (!line?.startsWith("cpu ")) return null;
  const values = line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map(Number)
    .filter((value) => Number.isFinite(value));
  if (values.length < 4) return null;
  const idle = (values[3] ?? 0) + (values[4] ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  return { idle, total };
};

const readCpuEnergySample = (): CpuEnergySample | null => {
  const root = "/sys/class/powercap";
  if (!existsSync(root)) return null;
  let totalEnergyMicrojoules = 0;
  let minMaxEnergyRangeMicrojoules: number | null = null;
  let packageCount = 0;

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.name.startsWith("intel-rapl:")) continue;
    const directory = join(root, entry.name);
    const name = readText(join(directory, "name"));
    if (!name?.startsWith("package-")) continue;

    const energy = toNumber(readText(join(directory, "energy_uj")) ?? undefined);
    if (energy === null) continue;
    const maxEnergyRange = toNumber(readText(join(directory, "max_energy_range_uj")) ?? undefined);
    totalEnergyMicrojoules += energy;
    packageCount += 1;
    if (maxEnergyRange !== null) {
      minMaxEnergyRangeMicrojoules =
        minMaxEnergyRangeMicrojoules === null
          ? maxEnergyRange
          : Math.min(minMaxEnergyRangeMicrojoules, maxEnergyRange);
    }
  }

  if (packageCount === 0) return readCpuEnergyHelperSample();
  return {
    energyMicrojoules: totalEnergyMicrojoules,
    maxEnergyRangeMicrojoules: minMaxEnergyRangeMicrojoules,
  };
};

export const readCpuEnergyHelperSample = (
  commandRunner: DashboardCommandRunner = runDashboardCommand,
  helperPath: string = CPU_ENERGY_HELPER,
): CpuEnergySample | null => {
  if (!existsSync(helperPath)) return null;
  const directResult = commandRunner(helperPath, [], 1_000);
  if (directResult.status === 0) return parseCpuEnergyHelperOutput(directResult.stdout);

  const sudoResult = commandRunner("sudo", ["-n", helperPath], 1_000);
  if (sudoResult.status !== 0) return null;
  return parseCpuEnergyHelperOutput(sudoResult.stdout);
};

export const parseCpuEnergyHelperOutput = (output: string): CpuEnergySample | null => {
  const [energyRaw, maxRaw] = output.trim().split(/\s+/);
  const energy = toNumber(energyRaw);
  if (energy === null) return null;
  const maxEnergyRange = toNumber(maxRaw);
  return {
    energyMicrojoules: energy,
    maxEnergyRangeMicrojoules: maxEnergyRange,
  };
};

const calculateCpuPowerWatts = (
  first: CpuEnergySample | null,
  second: CpuEnergySample | null,
  elapsedMs: number,
): number | null => {
  if (!first || !second || elapsedMs <= 0) return null;
  let delta = second.energyMicrojoules - first.energyMicrojoules;
  if (delta < 0 && first.maxEnergyRangeMicrojoules && first.maxEnergyRangeMicrojoules > 0) {
    delta += first.maxEnergyRangeMicrojoules;
  }
  if (delta < 0) return null;
  return roundOne(delta / elapsedMs / 1000);
};

type CpuEnergyCache = {
  sample: CpuEnergySample | null;
  collectedAt: number;
  powerDrawWatts: number | null;
};

let cpuEnergyCache: CpuEnergyCache | null = null;

const collectCpuPowerWatts = (): number | null => {
  const now = Date.now();
  if (cpuEnergyCache && now - cpuEnergyCache.collectedAt < CPU_POWER_SAMPLE_TTL_MS) {
    return cpuEnergyCache.powerDrawWatts;
  }

  const sample = readCpuEnergySample();
  if (!sample) {
    cpuEnergyCache = { sample: null, collectedAt: now, powerDrawWatts: null };
    return null;
  }

  const powerDrawWatts = cpuEnergyCache?.sample
    ? calculateCpuPowerWatts(cpuEnergyCache.sample, sample, now - cpuEnergyCache.collectedAt)
    : null;
  cpuEnergyCache = { sample, collectedAt: now, powerDrawWatts };
  return powerDrawWatts;
};

const collectCpu = (): Effect.Effect<LinuxDashboardSnapshot["cpu"]> =>
  Effect.gen(function* () {
    const cores = cpus().length || 1;
    const first = readCpuSample();
    let usage: number | null = null;
    if (first) {
      yield* Effect.sleep(250);
      const second = readCpuSample();
      if (second) {
        const idleDelta = second.idle - first.idle;
        const totalDelta = second.total - first.total;
        if (totalDelta > 0) {
          usage = roundOne(clampPercent(((totalDelta - idleDelta) / totalDelta) * 100));
        }
      }
    }

    const load1 = loadavg()[0] ?? 0;
    return {
      usage_percent: usage,
      cores,
      load_percent_1m: cores > 0 ? roundOne((load1 / cores) * 100) : null,
      power_draw_watts: collectCpuPowerWatts(),
    };
  });

const parseMemInfo = (): LinuxDashboardSnapshot["memory"] => {
  const meminfo = readText("/proc/meminfo");
  if (!meminfo) {
    const total = totalmem();
    return {
      total_bytes: total,
      available_bytes: total,
      used_bytes: 0,
      used_percent: 0,
      swap_total_bytes: 0,
      swap_used_bytes: 0,
    };
  }

  const values = new Map<string, number>();
  for (const line of meminfo.split("\n")) {
    const match = /^([^:]+):\s+(\d+)/.exec(line);
    if (match?.[1] && match[2]) values.set(match[1], Number(match[2]) * 1024);
  }
  const total = values.get("MemTotal") ?? totalmem();
  const available = values.get("MemAvailable") ?? values.get("MemFree") ?? 0;
  const swapTotal = values.get("SwapTotal") ?? 0;
  const swapFree = values.get("SwapFree") ?? 0;
  const used = Math.max(0, total - available);

  return {
    total_bytes: total,
    available_bytes: available,
    used_bytes: used,
    used_percent: total > 0 ? roundOne((used / total) * 100) : 0,
    swap_total_bytes: swapTotal,
    swap_used_bytes: Math.max(0, swapTotal - swapFree),
  };
};

const collectNvidiaGpus = (): DashboardGpu[] => {
  const nvidiaSmi = resolveNvidiaSmiBinary();
  if (!nvidiaSmi) return [];
  const query = [
    "index",
    "name",
    "uuid",
    "pci.bus_id",
    "utilization.gpu",
    "memory.total",
    "memory.used",
    "temperature.gpu",
    "temperature.memory",
    "fan.speed",
    "power.draw",
    "power.limit",
  ].join(",");
  const result = runDashboardCommand(
    nvidiaSmi,
    [`--query-gpu=${query}`, "--format=csv,noheader,nounits"],
    5_000,
  );
  if (result.status !== 0 || !result.stdout) return [];

  const rows = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const parsedRows = rows.map((line, fallbackIndex) => ({
    parts: line.split(",").map((part) => part.trim()),
    fallbackIndex,
  }));
  const needsLactFallback = parsedRows.some(({ parts }) => toNumber(parts[8]) === null);
  const lactMemoryTemperatures = needsLactFallback ? collectLactMemoryTemperatures() : null;

  return parsedRows.map(({ parts, fallbackIndex }) => {
    const totalMb = toNumber(parts[5]) ?? 0;
    const usedMb = toNumber(parts[6]) ?? 0;
    const totalBytes = totalMb * 1024 * 1024;
    const usedBytes = usedMb * 1024 * 1024;
    const temperature = toNumber(parts[7]);
    const nvidiaMemoryTemperature = toNumber(parts[8]);
    const normalizedPciBusId = normalizePciBusId(parts[3]);
    const lactMemoryTemperature =
      nvidiaMemoryTemperature === null && normalizedPciBusId && lactMemoryTemperatures
        ? lactMemoryTemperatures.byPciBus.get(normalizedPciBusId)
        : undefined;
    const memoryTemperature = nvidiaMemoryTemperature ?? lactMemoryTemperature?.value ?? null;
    const memoryTemperatureUnavailableReason =
      memoryTemperature === null
        ? [
            "NVIDIA SMI reported N/A.",
            lactMemoryTemperatures?.unavailableReason ??
              lactMemoryTemperature?.unavailableReason ??
              "LACT did not report this GPU.",
          ].join(" ")
        : null;
    const memoryPercent = totalBytes > 0 ? roundOne((usedBytes / totalBytes) * 100) : null;
    let status: LinuxDashboardHealth = "ok";
    if ((temperature ?? 0) >= 88 || (memoryPercent ?? 0) >= 98) status = "critical";
    else if ((temperature ?? 0) >= 82 || (memoryPercent ?? 0) >= 95) status = "warning";

    return {
      index: toNumber(parts[0]) ?? fallbackIndex,
      name: parts[1] || "NVIDIA GPU",
      uuid: parts[2] || null,
      pci_bus_id: parts[3] || null,
      utilization_percent: toNumber(parts[4]),
      memory_total_bytes: totalBytes,
      memory_used_bytes: usedBytes,
      memory_used_percent: memoryPercent,
      temperature_c: temperature,
      memory_temperature_c: memoryTemperature,
      memory_temperature_unavailable_reason: memoryTemperatureUnavailableReason,
      fan_percent: toNumber(parts[9]),
      power_draw_watts: toNumber(parts[10]),
      power_limit_watts: toNumber(parts[11]),
      status,
    };
  });
};

const collectGpus = (): Effect.Effect<DashboardGpu[]> =>
  Effect.gen(function* () {
    const nvidia = collectNvidiaGpus();
    if (nvidia.length > 0) return nvidia;

    const gpuInfo = yield* getGpuInfo();
    return gpuInfo.map((gpu) => {
      const total = gpu.memory_total_mb * 1024 * 1024;
      const used = gpu.memory_used_mb * 1024 * 1024;
      const memoryPercent = total > 0 ? roundOne((used / total) * 100) : null;
      let status: LinuxDashboardHealth = "ok";
      if (gpu.temp_c >= 88 || (memoryPercent ?? 0) >= 98) status = "critical";
      else if (gpu.temp_c >= 82 || (memoryPercent ?? 0) >= 95) status = "warning";

      return {
        index: gpu.index,
        name: gpu.name,
        uuid: null,
        pci_bus_id: null,
        utilization_percent: gpu.utilization_pct,
        memory_total_bytes: total,
        memory_used_bytes: used,
        memory_used_percent: memoryPercent,
        temperature_c: gpu.temp_c,
        memory_temperature_c: null,
        memory_temperature_unavailable_reason:
          "NVIDIA SMI was unavailable and this GPU source does not report VRAM temperature.",
        fan_percent: null,
        power_draw_watts: gpu.power_draw,
        power_limit_watts: gpu.power_limit,
        status,
      };
    });
  });

const readHwmon = (): { fans: DashboardFan[]; thermals: DashboardThermal[] } => {
  const root = "/sys/class/hwmon";
  const fans: DashboardFan[] = [];
  const thermals: DashboardThermal[] = [];
  if (!existsSync(root)) return { fans, thermals };

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const directory = join(root, entry.name);
    const chip = readText(join(directory, "name")) || basename(entry.name);
    for (const file of readdirSync(directory)) {
      const fanMatch = /^fan(\d+)_input$/.exec(file);
      if (fanMatch) {
        const rpm = Number(readText(join(directory, file)));
        if (Number.isFinite(rpm) && rpm > 0) {
          fans.push({
            chip,
            label: readText(join(directory, `fan${fanMatch[1]}_label`)) || `fan${fanMatch[1]}`,
            rpm,
          });
        }
      }

      const temporaryMatch = /^temp(\d+)_input$/.exec(file);
      if (temporaryMatch) {
        const raw = Number(readText(join(directory, file)));
        if (Number.isFinite(raw) && raw > 0) {
          thermals.push({
            chip,
            label:
              readText(join(directory, `temp${temporaryMatch[1]}_label`)) ||
              `temp${temporaryMatch[1]}`,
            value_c: roundOne(raw / 1000),
          });
        }
      }
    }
  }

  return {
    fans: fans.slice(0, 24),
    thermals: thermals.slice(0, 32),
  };
};

const checkPort = (port: number, timeoutMs = 600): Effect.Effect<boolean> =>
  Effect.callback<boolean>((resume) => {
    const socket = connect({ host: "127.0.0.1", port });
    let settled = false;
    const cleanup = (): void => {
      socket.removeListener("connect", onConnect);
      socket.removeListener("timeout", onTimeout);
      socket.removeListener("error", onError);
      socket.destroy();
    };
    const done = (result: boolean): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resume(Effect.succeed(result));
    };
    const onConnect = (): void => done(true);
    const onTimeout = (): void => done(false);
    const onError = (): void => done(false);
    socket.setTimeout(timeoutMs);
    socket.once("connect", onConnect);
    socket.once("timeout", onTimeout);
    socket.once("error", onError);
    return Effect.sync(cleanup);
  });

const checkSystemdService = (serviceName: string): boolean =>
  runDashboardCommand("systemctl", ["is-active", "--quiet", serviceName], 1_000).status === 0;

const collectServices = (inferencePort: number): Effect.Effect<DashboardService[]> =>
  Effect.gen(function* () {
    const portServices = [
      {
        id: "model",
        name: "Model API",
        port: inferencePort,
        endpoint: `:${inferencePort}`,
        description: "active inference endpoint",
      },
      {
        id: "studio",
        name: "vLLM Studio",
        port: 3000,
        endpoint: ":3000",
        description: "remote frontend",
      },
      {
        id: "grafana",
        name: "Grafana",
        port: 3030,
        endpoint: ":3030",
        description: "monitoring UI",
      },
      {
        id: "prometheus",
        name: "Prometheus",
        port: 9090,
        endpoint: ":9090",
        description: "metrics store",
      },
      {
        id: "searxng",
        name: "SearXNG",
        port: 8081,
        endpoint: ":8081",
        description: "private search",
      },
      {
        id: "infisical",
        name: "Infisical",
        port: 8082,
        endpoint: ":8082",
        description: "secrets UI",
      },
    ];

    const checks = yield* Effect.all(
      portServices.map((service) => checkPort(service.port)),
      { concurrency: "unbounded" },
    );
    const services: DashboardService[] = portServices.map((service, index) => ({
      id: service.id,
      name: service.name,
      endpoint: service.endpoint,
      description: service.description,
      status: checks[index] ? "running" : "stopped",
    }));

    services.push({
      id: "lact",
      name: "LACT",
      endpoint: "socket",
      description: "GPU control daemon",
      status: checkSystemdService("lactd.service") ? "running" : "stopped",
    });

    return services;
  });

const collectContainers = (): { containers: DashboardContainer[]; docker_error: string | null } => {
  const result = runDashboardCommand("docker", ["ps", "--format", "{{json .}}"], 2_000);
  if (result.status !== 0) {
    return {
      containers: [],
      docker_error: result.stderr || "docker ps failed",
    };
  }

  const containers = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line): DashboardContainer[] => {
      try {
        const value = JSON.parse(line) as Record<string, string>;
        return [
          {
            id: value["ID"] ?? "",
            name: value["Names"] ?? "",
            image: value["Image"] ?? "",
            status: value["Status"] ?? "",
            state: value["State"] ?? "",
            ports: value["Ports"] ?? "",
          },
        ];
      } catch {
        return [];
      }
    });

  return { containers, docker_error: null };
};

type SlowSnapshot = {
  disks: LinuxDashboardSnapshot["disks"];
  fans: DashboardFan[];
  thermals: DashboardThermal[];
  services: DashboardService[];
  containers: DashboardContainer[];
  docker_error: string | null;
};

let slowSnapshotCache: { value: SlowSnapshot; collectedAt: number } | null = null;

const collectSlowSnapshot = (context: AppContext): Effect.Effect<SlowSnapshot> =>
  Effect.gen(function* () {
    const now = Date.now();
    if (slowSnapshotCache && now - slowSnapshotCache.collectedAt < SLOW_SNAPSHOT_TTL_MS) {
      return slowSnapshotCache.value;
    }

    const [services, disks] = yield* Effect.all(
      [collectServices(context.config.inference_port), Effect.sync(collectDisks)],
      { concurrency: "unbounded" },
    );
    const { fans, thermals } = readHwmon();
    const { containers, docker_error } = collectContainers();
    const value = {
      disks,
      fans,
      thermals,
      services,
      containers,
      docker_error,
    };
    slowSnapshotCache = { value, collectedAt: Date.now() };
    return value;
  });

const buildAlerts = (snapshot: Omit<LinuxDashboardSnapshot, "alerts">): DashboardAlert[] => {
  const alerts: DashboardAlert[] = [];
  const push = (severity: LinuxDashboardAlertSeverity, source: string, message: string): void => {
    alerts.push({ severity, source, message });
  };

  if (snapshot.host.platform !== "linux") {
    push(
      "info",
      "host",
      `Dashboard is reading ${snapshot.host.platform}; Linux-only sensors are unavailable`,
    );
  }

  for (const disk of snapshot.disks) {
    if (!disk.mounted && snapshot.host.platform === "linux") {
      push("critical", disk.path, `${disk.path} is missing`);
      continue;
    }
    if (disk.status === "critical") {
      push("critical", disk.path, `${disk.path} free space is critically low`);
    } else if (disk.status === "warning") {
      push("warning", disk.path, `${disk.path} free space is getting low`);
    }
  }

  if (snapshot.memory.used_percent >= 92) {
    push("critical", "memory", "memory usage is above 92%");
  } else if (snapshot.memory.used_percent >= 85) {
    push("warning", "memory", "memory usage is above 85%");
  }

  for (const gpu of snapshot.gpus) {
    if ((gpu.temperature_c ?? 0) >= 88) {
      push("critical", `gpu${gpu.index}`, `${gpu.name} is above 88 C`);
    } else if ((gpu.temperature_c ?? 0) >= 82) {
      push("warning", `gpu${gpu.index}`, `${gpu.name} is above 82 C`);
    }
  }

  if (snapshot.gpus.length === 0 && snapshot.host.platform === "linux") {
    push("warning", "gpu", "no GPU telemetry available");
  }
  if (snapshot.fans.length === 0 && snapshot.host.platform === "linux") {
    push("info", "fans", "fan RPM is not exposed by hwmon");
  }

  return alerts;
};

export const collectLinuxDashboardSnapshot = (
  context: AppContext,
): Effect.Effect<LinuxDashboardSnapshot> =>
  Effect.gen(function* () {
    const [cpu, slowSnapshot, gpus] = yield* Effect.all(
      [collectCpu(), collectSlowSnapshot(context), collectGpus()],
      { concurrency: "unbounded" },
    );
    const cpuIdentity = collectCpuIdentity();
    const hostLoad = loadavg();

    const snapshotWithoutAlerts = {
      collected_at: new Date().toISOString(),
      host: {
        hostname: hostname(),
        platform: platform(),
        kernel: release(),
        arch: arch(),
        uptime_seconds: Math.floor(uptime()),
        load_average: [
          roundOne(hostLoad[0] ?? 0),
          roundOne(hostLoad[1] ?? 0),
          roundOne(hostLoad[2] ?? 0),
        ] as [number, number, number],
        cpu_cores: cpu.cores,
        cpu_model: cpuIdentity.model,
        cpu_physical_cores: cpuIdentity.physicalCores,
        cpu_threads: cpuIdentity.threads,
        target: "controller-host" as const,
      },
      cpu,
      memory: parseMemInfo(),
      gpus,
      disks: slowSnapshot.disks,
      fans: slowSnapshot.fans,
      thermals: slowSnapshot.thermals,
      services: slowSnapshot.services,
      containers: slowSnapshot.containers,
      docker_error: slowSnapshot.docker_error,
    };

    return {
      ...snapshotWithoutAlerts,
      alerts: buildAlerts(snapshotWithoutAlerts),
    };
  });
