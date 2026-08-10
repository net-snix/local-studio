import { spawn, spawnSync, type ChildProcess } from "node:child_process";

type SpawnDetached = (
  command: string,
  args: string[],
  options: { detached: true; stdio: "ignore"; env: NodeJS.ProcessEnv }
) => Pick<ChildProcess, "unref">;

type SpawnSudoProbe = (
  command: string,
  args: string[],
  options: { timeout: number; env: NodeJS.ProcessEnv }
) => { status: number | null; stderr?: Buffer | string | null };

type HostPowerOptions = {
  sudoProbe?: SpawnSudoProbe;
  spawnDetached?: SpawnDetached;
  env?: NodeJS.ProcessEnv;
};

export type HostPowerResult =
  | { success: true; command: string[] }
  | { success: false; error: string };

const shutdownCommand = ["sudo", "-n", "shutdown", "-P", "now"] as const;
const restartCommand = ["sudo", "-n", "shutdown", "-r", "now"] as const;

const formatProbeError = (stderr: Buffer | string | null | undefined): string => {
  const message =
    typeof stderr === "string" ? stderr.trim() : stderr ? stderr.toString("utf-8").trim() : "";
  return message || "sudo is not available without a password for the controller service user.";
};

export const getShutdownHostCommand = (): string[] => [...shutdownCommand];

export const getRestartHostCommand = (): string[] => [...restartCommand];

const scheduleHostPowerCommand = (
  command: readonly string[],
  { sudoProbe = spawnSync, spawnDetached = spawn, env = process.env }: HostPowerOptions = {}
): HostPowerResult => {
  const executable = command[0];
  if (!executable) {
    return { success: false, error: "Host power command is empty." };
  }

  const args = command.slice(1);
  const sudo = sudoProbe("sudo", ["-n", "true"], { timeout: 1_000, env });
  if (sudo.status !== 0) {
    return {
      success: false,
      error: formatProbeError(sudo.stderr),
    };
  }

  try {
    const child = spawnDetached(executable, args, {
      detached: true,
      stdio: "ignore",
      env,
    });
    child.unref();
    return { success: true, command: [...command] };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const scheduleHostShutdown = (options?: HostPowerOptions): HostPowerResult =>
  scheduleHostPowerCommand(shutdownCommand, options);

export const scheduleHostRestart = (options?: HostPowerOptions): HostPowerResult =>
  scheduleHostPowerCommand(restartCommand, options);
