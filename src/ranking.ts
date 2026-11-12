import type { RouteAssessment, ScenarioComparison } from "./contracts.ts";

export interface ScenarioPriority {
  readonly scenarioIndex: number;
  readonly group: number | null;
  readonly reason: string;
}

/** Server-owned Pareto layers. No currency/carbon conversion or model preference. */
export function rankScenarios(
  scenarios: readonly ScenarioComparison[],
  routes: readonly RouteAssessment[],
): readonly ScenarioPriority[] {
  const priorities: ScenarioPriority[] = [];
  const comparable: number[] = [];
  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    const route = routes.find((item) => item.routeId === scenario.routeId);
    let reason: string | undefined;
    if (route?.eligibility.state !== "eligible") reason = "적합성 미충족 또는 미확인: 순위 보류";
    else if (scenario.netCost.state === "unavailable" || scenario.netEmissions.state === "unavailable") {
      reason = "순비용 또는 순배출 자료 부족: 순위 보류";
    }
    if (reason !== undefined) priorities.push({ scenarioIndex, group: null, reason });
    else comparable.push(scenarioIndex);
  }
  const first = scenarios[comparable[0] ?? -1];
  const sameBasis = comparable.every((index) => {
    const scenario = scenarios[index];
    return scenario?.functionalUnit === first?.functionalUnit && scenario?.boundary === first?.boundary;
  });
  if (!sameBasis || comparable.length < 2) {
    for (const scenarioIndex of comparable) priorities.push({ scenarioIndex, group: null,
      reason: sameBasis ? "비교 가능한 후보가 2개 미만: 순위 보류" : "기능단위 또는 계산 경계 불일치: 순위 보류" });
    return priorities.sort((a, b) => a.scenarioIndex - b.scenarioIndex);
  }
  const dominates = (a: number, b: number): boolean => {
    const left = scenarios[a], right = scenarios[b];
    if (left === undefined || right === undefined || left.netCost.state !== "available" || right.netCost.state !== "available"
      || left.netEmissions.state !== "available" || right.netEmissions.state !== "available") return false;
    return left.netCost.high <= right.netCost.low && left.netEmissions.high <= right.netEmissions.low
      && (left.netCost.high < right.netCost.low || left.netEmissions.high < right.netEmissions.low);
  };
  let remaining = comparable;
  let group = 1;
  while (remaining.length > 0) {
    const front = remaining.filter((index) => !remaining.some((other) => dominates(other, index)));
    for (const scenarioIndex of front) {
      const dominators = comparable.filter((other) => dominates(other, scenarioIndex));
      priorities.push({ scenarioIndex, group,
        reason: dominators.length === 0
          ? "비용·탄소 모두에서 확실히 우월한 다른 후보 없음"
          : `두 지표의 범위로 우월한 후보: 입력 비교표 ${dominators.map((index) => index + 1).join(", ")}번 대안`,
      });
    }
    remaining = remaining.filter((index) => !front.includes(index));
    group += 1;
  }
  return priorities.sort((a, b) => (a.group ?? Infinity) - (b.group ?? Infinity) || a.scenarioIndex - b.scenarioIndex);
}
