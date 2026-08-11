import type { DashboardUsageSample } from "./dashboard-history";

export type DashboardChartPoint = {
  x: number;
  y: number;
};

export type DashboardChartGeometry = {
  width: number;
  height: number;
  pad: number;
};

export const projectDashboardChartSegments = (
  samples: DashboardUsageSample[],
  scaleMax: number,
  windowMs: number,
  geometry: DashboardChartGeometry,
): DashboardChartPoint[][] => {
  const latestTime = samples.at(-1)?.time;
  if (typeof latestTime !== "number" || !Number.isFinite(latestTime)) return [];

  const start = latestTime - windowMs;
  const drawableWidth = geometry.width - geometry.pad * 2;
  const drawableHeight = geometry.height - geometry.pad * 2;
  const segments: DashboardChartPoint[][] = [];
  let segment: DashboardChartPoint[] = [];

  const finishSegment = (): void => {
    if (segment.length > 0) segments.push(segment);
    segment = [];
  };

  for (const sample of samples) {
    if (sample.break_before) finishSegment();
    if (
      typeof sample.value !== "number" ||
      !Number.isFinite(sample.value) ||
      !Number.isFinite(sample.time) ||
      sample.time < start ||
      sample.time > latestTime
    ) {
      finishSegment();
      continue;
    }

    const x = geometry.pad + ((sample.time - start) / windowMs) * drawableWidth;
    const value = Math.min(scaleMax, Math.max(0, sample.value));
    const y = geometry.pad + ((scaleMax - value) / scaleMax) * drawableHeight;
    segment.push({ x, y });
  }

  finishSegment();
  return segments;
};

export const dashboardChartPath = (points: DashboardChartPoint[]): string => {
  const [first, ...rest] = points;
  if (!first || rest.length === 0) return "";
  return rest.reduce((path, point) => `${path} L ${point.x} ${point.y}`, `M ${first.x} ${first.y}`);
};
