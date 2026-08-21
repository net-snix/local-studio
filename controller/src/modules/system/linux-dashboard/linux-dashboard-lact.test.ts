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

  it("falls back to the hottest per-chip sensor when no aggregate VRAM reading exists", () => {
    // RTX PRO 6000 Blackwell Max-Q: 32 GDDR7 chips, no roll-up field.
    const maxQ = [
      "Temperatures: GPU: 55°C, GPU Hotspot: 57°C,",
      "VRAM Chip A0 (Front): 52°C, VRAM Chip A0 (Back): 52°C,",
      "VRAM Chip D0 (Front): 56°C, VRAM Chip D0 (Back): 56°C,",
      "VRAM Chip H1 (Front): 54°C, VRAM Chip H1 (Back): 54°C",
    ].join(" ");
    expect(parseLactVramTemperature(maxQ)).toBe(56);
  });

  it("prefers the aggregate reading when a card reports both", () => {
    // RTX PRO 6000 Blackwell Workstation Edition reports both forms.
    const workstation =
      "Temperatures: GPU: 43°C, GPU Hotspot: 46°C, VRAM: 48°C, " +
      "VRAM Chip A0 (Front): 44°C, VRAM Chip A0 (Back): 44°C";
    expect(parseLactVramTemperature(workstation)).toBe(48);
  });

  it("returns null when neither an aggregate nor a per-chip reading is present", () => {
    expect(parseLactVramTemperature("Temperatures: GPU: 40°C, GPU Hotspot: 45°C")).toBeNull();
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
