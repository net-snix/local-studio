export interface ServiceInfo {
  name: string;
  port: number;
  internal_port: number;
  protocol: string;
  status: string;
  description?: string | null;
}

export interface SystemConfig {
  host: string;
  port: number;
  inference_port: number;
  api_key_configured: boolean;
  models_dir: string;
  data_dir: string;
  db_path: string;
  sglang_python: string | null;
  llama_bin: string | null;
  mlx_python: string | null;
}

export interface EnvironmentInfo {
  controller_url: string;
  inference_url: string;
  frontend_url: string;
}

export interface RuntimeBackendInfo {
  installed: boolean;
  version: string | null;
  python_path?: string | null;
  binary_path?: string | null;
  upgrade_command_available?: boolean;
}

export type EngineBackend = "vllm" | "sglang" | "llamacpp" | "mlx";

export type RuntimeKind = "venv" | "docker" | "binary" | "system";

export interface RuntimeTarget {
  id: string;
  backend: EngineBackend;
  kind: RuntimeKind;
  label: string;
  installed: boolean;
  active: boolean;
  version: string | null;
  pythonPath?: string | null;
  binaryPath?: string | null;
  dockerImage?: string | null;
  source: "configured" | "discovered" | "running" | "bundled";
  capabilities: {
    canLaunch: boolean;
    canUpdate: boolean;
    canInspectOptions: boolean;
    supportsDocker: boolean;
  };
  health: {
    status: "ok" | "warning" | "error" | "unknown";
    message?: string;
  };
  update?: {
    currentVersion: string | null;
    targetVersion: string;
    packageSpec: string;
    releaseNotesUrl: string;
    restartRequired: boolean;
    changes: string[];
  };
}

export interface EngineJob {
  id: string;
  backend: EngineBackend;
  targetId?: string;
  type: "install" | "update" | "download" | "inspect";
  status: "queued" | "running" | "success" | "error" | "cancelled";
  progress?: number;
  message: string;
  command?: string;
  startedAt: string;
  finishedAt?: string;
  outputTail?: string;
  error?: string;
}

export type RuntimePlatformKind = "cuda" | "rocm" | "metal" | "unknown";

export type RuntimeRocmSmiTool = "amd-smi" | "rocm-smi";

export type RuntimeGpuMonitoringTool =
  | "nvidia-smi"
  | "intel-sysfs"
  | "apple-metal"
  | RuntimeRocmSmiTool;

export interface RuntimeCudaInfo {
  driver_version: string | null;
  cuda_version: string | null;
  upgrade_command_available: boolean;
}

export interface RuntimeRocmInfo {
  rocm_version: string | null;
  hip_version: string | null;
  smi_tool: RuntimeRocmSmiTool | null;
  gpu_arch: string[];
  upgrade_command_available: boolean;
}

export interface RuntimeTorchBuildInfo {
  torch_version: string | null;
  torch_cuda: string | null;
  torch_hip: string | null;
}

export interface RuntimePlatformInfo {
  kind: RuntimePlatformKind;
  vendor: "nvidia" | "amd" | "apple" | null;
  rocm: RuntimeRocmInfo | null;
  torch: RuntimeTorchBuildInfo;
}

export interface RuntimeGpuMonitoringInfo {
  available: boolean;
  tool: RuntimeGpuMonitoringTool | null;
}

export interface RuntimeGpuInfoSummary {
  count: number;
  types: string[];
}

export type CompatibilitySeverity = "info" | "warn" | "error";

export interface CompatibilityCheck {
  id: string;
  severity: CompatibilitySeverity;
  message: string;
  evidence: string | null;
  suggested_fix: string | null;
}

export interface SystemRuntimeInfo {
  platform: RuntimePlatformInfo;
  gpu_monitoring: RuntimeGpuMonitoringInfo;
  cuda: RuntimeCudaInfo;
  gpus: RuntimeGpuInfoSummary;
  backends: {
    vllm: RuntimeBackendInfo;
    sglang: RuntimeBackendInfo;
    llamacpp: RuntimeBackendInfo;
    mlx?: RuntimeBackendInfo;
  };
}

export interface CompatibilityReport {
  platform: {
    kind: RuntimePlatformKind;
  };
  gpu_monitoring: RuntimeGpuMonitoringInfo;
  torch: RuntimeTorchBuildInfo;
  backends: SystemRuntimeInfo["backends"];
  checks: CompatibilityCheck[];
}

export interface ConfigData {
  config: SystemConfig;
  services: ServiceInfo[];
  environment: EnvironmentInfo;
  runtime: SystemRuntimeInfo;
}

export type LinuxDashboardHealth = "ok" | "warning" | "critical" | "unknown";
export type LinuxDashboardAlertSeverity = "info" | "warning" | "critical";

export interface LinuxDashboardAlert {
  severity: LinuxDashboardAlertSeverity;
  source: string;
  message: string;
}

export interface LinuxDashboardGpu {
  index: number;
  name: string;
  uuid: string | null;
  pci_bus_id: string | null;
  utilization_percent: number | null;
  memory_total_bytes: number;
  memory_used_bytes: number;
  memory_used_percent: number | null;
  temperature_c: number | null;
  memory_temperature_c: number | null;
  memory_temperature_unavailable_reason: string | null;
  fan_percent: number | null;
  power_draw_watts: number | null;
  power_limit_watts: number | null;
  status: LinuxDashboardHealth;
}

export interface LinuxDashboardDisk {
  path: string;
  label: string;
  mounted: boolean;
  device: string | null;
  device_model: string | null;
  device_size: string | null;
  filesystem: string | null;
  mountpoint: string | null;
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  used_percent: number | null;
  status: LinuxDashboardHealth;
}

export interface LinuxDashboardService {
  id: string;
  name: string;
  endpoint: string;
  status: "running" | "stopped";
  description: string;
}

export interface LinuxDashboardContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
}

export interface LinuxDashboardThermal {
  chip: string;
  label: string;
  value_c: number;
}

export interface LinuxDashboardFan {
  chip: string;
  label: string;
  rpm: number;
}

export interface LinuxDashboardSnapshot {
  collected_at: string;
  host: {
    hostname: string;
    platform: string;
    kernel: string;
    arch: string;
    uptime_seconds: number;
    load_average: [number, number, number];
    cpu_cores: number;
    cpu_model: string | null;
    cpu_physical_cores: number;
    cpu_threads: number;
    target: "controller-host";
  };
  cpu: {
    usage_percent: number | null;
    cores: number;
    load_percent_1m: number | null;
    power_draw_watts: number | null;
  };
  memory: {
    total_bytes: number;
    available_bytes: number;
    used_bytes: number;
    used_percent: number;
    swap_total_bytes: number;
    swap_used_bytes: number;
  };
  gpus: LinuxDashboardGpu[];
  disks: LinuxDashboardDisk[];
  fans: LinuxDashboardFan[];
  thermals: LinuxDashboardThermal[];
  services: LinuxDashboardService[];
  containers: LinuxDashboardContainer[];
  docker_error: string | null;
  alerts: LinuxDashboardAlert[];
}

export interface RuntimeUpgradeResult {
  success: boolean;
  version: string | null;
  output: string | null;
  error: string | null;
  used_command: string | null;
}
