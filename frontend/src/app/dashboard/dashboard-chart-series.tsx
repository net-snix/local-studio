import { dashboardChartPath, type DashboardChartPoint } from "./dashboard-chart-model";

export function DashboardChartSeries({
  segments,
  stroke,
  strokeOpacity,
  strokeWidth,
}: {
  segments: DashboardChartPoint[][];
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
}) {
  return segments.map((segment, index) => {
    const point = segment[0];
    const path = dashboardChartPath(segment);
    return path ? (
      <path
        key={index}
        d={path}
        fill="none"
        stroke={stroke}
        strokeLinecap="square"
        strokeLinejoin="miter"
        strokeOpacity={strokeOpacity}
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
      />
    ) : point ? (
      <circle
        key={index}
        cx={point.x}
        cy={point.y}
        r={2.2}
        fill={stroke}
        fillOpacity={strokeOpacity}
        vectorEffect="non-scaling-stroke"
      />
    ) : null;
  });
}
