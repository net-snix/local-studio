import { describe, expect, it } from "bun:test";
import {
  normalizePciBusId,
  parseLactGpuList,
  parseLactVramTemperature,
} from "./linux-dashboard-lact";

describe("linux dashboard LACT telemetry", () => {
  it("maps LACT GPU ids to normalized PCI bus ids", () => {
    expect(
      parseLactGpuList(
        [
          "0: 10DE:2204-1462:3882-0000:41:00.0 (NVIDIA GeForce RTX 3090) [Dedicated]",
          "1: 10DE:2BB1-10DE:204B-0000:81:00.0 (NVIDIA RTX PRO 6000 Blackwell Workstation Edition) [Dedicated]",
        ].join("\n")
      )
    ).toEqual([
      { lactIndex: 0, pciBusId: "41:00.0" },
      { lactIndex: 1, pciBusId: "81:00.0" },
    ]);
  });

  it("normalizes NVIDIA SMI PCI ids with long domains", () => {
    expect(normalizePciBusId("00000000:41:00.0")).toBe("41:00.0");
  });

  it("parses VRAM temperature from LACT stats", () => {
    expect(parseLactVramTemperature("Temperatures: GPU Hotspot: 50°C, VRAM: 43°C, GPU: 40°C")).toBe(
      43
    );
  });

  it("returns null when LACT stats omit VRAM temperature", () => {
    expect(parseLactVramTemperature("Temperatures: GPU Hotspot: 30°C, GPU: 31°C")).toBeNull();
  });
});
