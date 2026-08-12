import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dashboardChartPath, projectDashboardChartSegments } from "./dashboard-chart-model";

const geometry = { width: 100, height: 100, pad: 10 } as const;

describe("dashboard chart projection", () => {
  test("projects contiguous samples into one segment on a fixed rolling domain", () => {
    const segments = projectDashboardChartSegments(
      [
        { time: 0, value: 10 },
        { time: 1000, value: 20 },
      ],
      100,
      1000,
      geometry,
    );

    assert.equal(segments.length, 1);
    assert.deepEqual(
      segments[0]?.map((point) => point.x),
      [10, 90],
    );
    assert.match(dashboardChartPath(segments[0] ?? []), /^M 10 82 L 90 74$/);
  });

  test("keeps timestamped samples on one continuous line", () => {
    const segments = projectDashboardChartSegments(
      [
        { time: 0, value: 10 },
        { time: 1000, value: 20 },
        { time: 2000, value: 90 },
        { time: 3000, value: 80 },
      ],
      100,
      60_000,
      geometry,
    );

    assert.equal(segments.length, 1);
    assert.deepEqual(
      segments.map((segment) => segment.map((point) => point.y)),
      [[82, 74, 18, 26]],
    );
  });

  test("splits around unavailable samples instead of bridging them", () => {
    const segments = projectDashboardChartSegments(
      [
        { time: 0, value: 10 },
        { time: 1000, value: null },
        { time: 2000, value: 30 },
      ],
      100,
      60_000,
      geometry,
    );

    assert.equal(segments.length, 2);
    assert.deepEqual(
      segments.map((segment) => segment.length),
      [1, 1],
    );
    assert.equal(dashboardChartPath(segments[1] ?? []), "");
  });
});
