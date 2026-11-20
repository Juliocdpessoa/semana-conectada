import { test, expect } from "bun:test";
import { createPerformanceSampler, performanceOperation } from "../src/lib/performance-policy";

test("distinguishes filters without inspecting or retaining their contents", () => {
  expect(
    performanceOperation({
      search: "",
      statuses: [],
      confinedSpace: "all",
      sapStatusById: { x: "status" },
    }),
  ).toBe("activities_list");
  expect(performanceOperation({ statuses: ["EXECUTADO"] })).toBe("activities_filter");
  expect(performanceOperation({ search: "example" })).toBe("activities_filter");
});
test("caps each operation at one sample per minute and samples subsequent successes", () => {
  let time = 0;
  const sample = createPerformanceSampler(
    () => time,
    () => 0.9,
  );
  expect(sample("activities_list", true)).toBe(true);
  expect(sample("activities_list", false)).toBe(false);
  expect(sample("activities_filter", true)).toBe(true);
  time = 60000;
  expect(sample("activities_list", true)).toBe(false);
  expect(sample("activities_list", false)).toBe(true);
  expect(sample("activities_list", false)).toBe(false);
});
test("accepted success sampling stays bounded after time advances", () => {
  let time = 100;
  const sample = createPerformanceSampler(
    () => time,
    () => 0.1,
  );
  expect(sample("activities_filter", true)).toBe(true);
  time += 60000;
  expect(sample("activities_filter", true)).toBe(true);
  expect(sample("activities_filter", true)).toBe(false);
});
