import { describe, expect, it } from "bun:test";
import {
  parseCpuEnergyHelperOutput,
  parseCpuInfoIdentity,
  parseCpuPowerSampleTtl,
  readCpuEnergyHelperSample,
} from "./linux-dashboard-collector";
import { parseDiskTargets } from "./linux-dashboard-disks";

const cpuEntry = (processor: number, physicalId: number, coreId: number): string => `
processor   : ${processor}
physical id : ${physicalId}
core id     : ${coreId}
cpu cores   : 2
model name  : Test CPU
`;

describe("linux dashboard CPU identity", () => {
  it("counts physical cores from topology instead of assuming threads divided by two", () => {
    const cpuinfo = [
      cpuEntry(0, 0, 0),
      cpuEntry(1, 0, 0),
      cpuEntry(2, 0, 1),
      cpuEntry(3, 0, 1),
    ].join("\n");

    expect(parseCpuInfoIdentity(cpuinfo, null, 4)).toEqual({
      model: "Test CPU",
      physicalCores: 2,
      threads: 4,
    });
  });

  it("supports CPUs where core count equals thread count", () => {
    const cpuinfo = [cpuEntry(0, 0, 0), cpuEntry(1, 0, 1), cpuEntry(2, 0, 2)].join("\n");

    expect(parseCpuInfoIdentity(cpuinfo, null, 3)).toEqual({
      model: "Test CPU",
      physicalCores: 3,
      threads: 3,
    });
  });

  it("counts physical cores across multiple sockets", () => {
    const cpuinfo = [
      cpuEntry(0, 0, 0),
      cpuEntry(1, 0, 1),
      cpuEntry(2, 1, 0),
      cpuEntry(3, 1, 1),
    ].join("\n");

    expect(parseCpuInfoIdentity(cpuinfo, null, 4)).toEqual({
      model: "Test CPU",
      physicalCores: 4,
      threads: 4,
    });
  });
});

describe("linux dashboard CPU power helper", () => {
  it("accepts only positive integer cache TTL overrides", () => {
    expect(parseCpuPowerSampleTtl("60000", 5000)).toBe(60000);
    expect(parseCpuPowerSampleTtl("0", 5000)).toBe(5000);
    expect(parseCpuPowerSampleTtl("1.5", 5000)).toBe(5000);
    expect(parseCpuPowerSampleTtl("nope", 5000)).toBe(5000);
  });

  it("parses privileged powercap energy samples", () => {
    expect(parseCpuEnergyHelperOutput("123456 999999")).toEqual({
      energyMicrojoules: 123456,
      maxEnergyRangeMicrojoules: 999999,
    });
  });

  it("rejects invalid helper output", () => {
    expect(parseCpuEnergyHelperOutput("not-energy")).toBeNull();
  });

  it("reads the helper directly before falling back to sudo", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const sample = readCpuEnergyHelperSample((command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: "123456 999999", stderr: "" };
    }, process.execPath);

    expect(sample).toEqual({
      energyMicrojoules: 123456,
      maxEnergyRangeMicrojoules: 999999,
    });
    expect(calls).toEqual([{ command: process.execPath, args: [] }]);
  });

  it("falls back to sudo only when direct helper execution fails", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const sample = readCpuEnergyHelperSample((command, args) => {
      calls.push({ command, args });
      if (calls.length === 1) return { status: 1, stdout: "", stderr: "permission denied" };
      return { status: 0, stdout: "654321 999999", stderr: "" };
    }, process.execPath);

    expect(sample).toEqual({
      energyMicrojoules: 654321,
      maxEnergyRangeMicrojoules: 999999,
    });
    expect(calls).toEqual([
      { command: process.execPath, args: [] },
      { command: "sudo", args: ["-n", process.execPath] },
    ]);
  });
});

describe("linux dashboard disk targets", () => {
  it("parses configured disk labels without hard-coded personal paths", () => {
    expect(parseDiskTargets("root:/,models:/models,training:/training")).toEqual([
      { label: "root", path: "/" },
      { label: "models", path: "/models" },
      { label: "training", path: "/training" },
    ]);
  });

  it("falls back to root when no disk config is provided", () => {
    expect(parseDiskTargets(undefined)).toEqual([{ label: "root", path: "/" }]);
  });
});
