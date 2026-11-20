import assert from "node:assert/strict";
import type { Dataset, PublicCalculationResult } from "../../../../src/o-public-calculation-schema.ts";

// Independent exact rational arithmetic; no production numeric/rounding helpers.
class Rational {
  constructor(readonly n: bigint, readonly d: bigint = 1n) { assert.ok(d > 0n); }
  static decimal(value: number | string) {
    const [coefficient = "0", exponent = "0"] = String(value).toLowerCase().split("e");
    const [whole = "0", fraction = ""] = coefficient.split(".");
    const shift = Number(exponent) - fraction.length;
    const digits = BigInt(whole + fraction);
    return shift >= 0 ? new Rational(digits * 10n ** BigInt(shift)) : new Rational(digits, 10n ** BigInt(-shift));
  }
  add(b: Rational) { return new Rational(this.n * b.d + b.n * this.d, this.d * b.d); }
  sub(b: Rational) { return new Rational(this.n * b.d - b.n * this.d, this.d * b.d); }
  mul(b: Rational) { return new Rational(this.n * b.n, this.d * b.d); }
  div(b: Rational) { assert.ok(b.n > 0n); return new Rational(this.n * b.d, this.d * b.n); }
  number() { return Number(this.n) / Number(this.d); }
  round(places: number) {
    const magnitude = this.n < 0n ? -this.n : this.n;
    const rounded = (2n * magnitude * 10n ** BigInt(places) + this.d) / (2n * this.d);
    const digits = rounded.toString().padStart(places + 1, "0");
    return (this.n < 0n && rounded !== 0n ? "-" : "") +
      (places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits);
  }
}

export function independentRows(data: Dataset) {
  assert.equal(data.cases.length, 1);
  const c = data.cases[0];
  assert.ok(c && c.mass_t !== null);
  const q = (id: string) => {
    const input = data.inputs.find(i => i.input_id === id);
    assert.ok(input && input.value !== null, id);
    return Rational.decimal(input.value);
  };
  const mass = Rational.decimal(c.mass_t), y = q(`${c.material}.y`);
  const zero = Rational.decimal(0), one = Rational.decimal(1);
  const conversion = Rational.decimal(1000).div(Rational.decimal("0.90718474"));
  // Expanded per-input-tonne expressions, rather than engine mass-flow accumulation.
  const landfillRate = q("c").add(q("d0").mul(q("r"))).add(q("f"));
  const recyclingRate = q("c").add(q("d1").mul(q("r"))).add(q("s"))
    .add(one.sub(y).mul(q("d2").mul(q("r")).add(q("f"))))
    .add(y.mul(q("f_rec").sub(q(`${c.material}.price`))));
  const baselineCost = mass.mul(landfillRate);
  const baseFactor = q(`warm.${c.material}.landfill`);
  const baselineCarbon = mass.mul(baseFactor).mul(conversion);
  const expected = (["recycling", "landfill", "energy_recovery"] as const).map(route => {
    const recycling = route === "recycling", landfill = route === "landfill";
    const cost = recycling ? mass.mul(recyclingRate) : landfill ? baselineCost : null;
    const carbon = recycling
      ? mass.mul(baseFactor.add(y.mul(q(`warm.${c.material}.recycling`).sub(baseFactor)))).mul(conversion)
      : mass.mul(q(`warm.${c.material}.${route}`)).mul(conversion);
    const metrics = { net_cost_krw: cost, net_carbon_kgco2e: carbon,
      cost_saving_krw: cost === null ? null : baselineCost.sub(cost),
      scenario_carbon_difference_kgco2e: baselineCarbon.sub(carbon) };
    const components = cost === null ? null : {
      collection: mass.mul(q("c")),
      transport: mass.mul(recycling ? q("d1").add(one.sub(y).mul(q("d2"))) : q("d0")).mul(q("r")),
      sorting: recycling ? mass.mul(q("s")) : zero,
      treatment: recycling ? mass.mul(one.sub(y).mul(q("f")).add(y.mul(q("f_rec")))) : mass.mul(q("f")),
    };
    return {
      route_id: route,
      metrics: Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, value?.number() ?? null])),
      display: Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, value?.round(key.endsWith("krw") ? 0 : 2) ?? null])),
      components: components === null ? null : Object.fromEntries(Object.entries(components).map(([key, value]) => [key, value.number()])),
      revenue: cost === null ? null : recycling ? mass.mul(y).mul(q(`${c.material}.price`)).number() : 0,
      per_tonne: { cost_krw: cost?.div(mass).number() ?? null, carbon_kgco2e: carbon.div(mass).number() },
      mass_flow: { input_t: mass.number(), recycling_t: recycling ? mass.mul(y).number() : 0,
        residue_t: recycling ? mass.mul(one.sub(y)).number() : mass.number() },
    };
  });
  return expected;
}

export function compareNumbers(actual: unknown, expected: unknown) {
  let comparisons = 0, maximumAbsoluteError = 0;
  const visit = (a: unknown, e: unknown) => {
    if (typeof e === "number") {
      assert.equal(typeof a, "number");
      assert.ok(typeof a === "number" && Number.isFinite(a));
      const error = Math.abs(a - e);
      maximumAbsoluteError = Math.max(maximumAbsoluteError, error);
      assert.ok(error <= 1e-9, `numeric mismatch: ${a} versus ${e}`);
      comparisons++;
    } else if (e !== null && typeof e === "object") {
      assert.ok(a !== null && typeof a === "object");
      for (const [key, value] of Object.entries(e)) {
        assert.ok(Object.hasOwn(a, key));
        visit(Reflect.get(a, key), value);
      }
    } else assert.deepEqual(a, e);
  };
  visit(actual, expected);
  return { comparisons, maximum_absolute_error: maximumAbsoluteError, tolerance: 1e-9 };
}

export function ranking(rows: readonly PublicCalculationResult[]) {
  const order = (key: "net_cost_krw" | "net_carbon_kgco2e") => {
    const known = rows.filter(r => r[key] !== null);
    const values = [...new Set(known.map(r => r[key]))].sort((a, b) => (a ?? 0) - (b ?? 0));
    return { ascending_tie_groups: values.map(value => known.filter(r => r[key] === value).map(r => r.route_id)),
      unavailable: rows.filter(r => r[key] === null).map(r => r.route_id) };
  };
  const complete = rows.filter(r => r.net_cost_krw !== null && r.net_carbon_kgco2e !== null);
  const dominates = (a: PublicCalculationResult, b: PublicCalculationResult) =>
    a.net_cost_krw !== null && b.net_cost_krw !== null && a.net_carbon_kgco2e !== null && b.net_carbon_kgco2e !== null &&
    a.net_cost_krw <= b.net_cost_krw && a.net_carbon_kgco2e <= b.net_carbon_kgco2e &&
    (a.net_cost_krw < b.net_cost_krw || a.net_carbon_kgco2e < b.net_carbon_kgco2e);
  return { cost: order("net_cost_krw"), carbon: order("net_carbon_kgco2e"),
    pareto_complete_routes: complete.filter(b => !complete.some(a => dominates(a, b))).map(r => r.route_id),
    pareto_excluded_missing_metric: rows.filter(r => !complete.includes(r)).map(r => r.route_id),
    pareto_scope: "Complete metrics only. No global three-route Pareto claim because incineration cost is unknown." };
}
