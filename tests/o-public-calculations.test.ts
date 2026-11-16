import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { readPublicCalculationDataset } from "../src/o-public-calculation-data.ts";
import { revision } from "../src/o-validation.ts";
import { readCaseResearchCatalog } from "../src/o-case-research.ts";
import fixtureJson from "../data/o-public-calculations/2026-11-15/fixtures.json" with { type: "json" };
import manifestJson from "../data/o-public-calculations/2026-11-15/manifest.json" with { type: "json" };

const root = fileURLToPath(new URL("../", import.meta.url)), dataset = "data/o-public-calculations/2026-11-15";
const script = join(root, "scripts/o-public-calculations.ts"), label = "공개 자료 기반 계산값(관측값 아님)";
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
type Fixture = typeof fixtureJson;
const num = Type.Union([Type.Number(), Type.Null()]), str = Type.Union([Type.String(), Type.Null()]);
const metrics = Type.Object({ net_cost_krw: num, net_carbon_kgco2e: num, cost_saving_krw: num, scenario_carbon_difference_kgco2e: num });
const resultSchema = Type.Object({ ...metrics.properties, case_id: Type.String(), route_id: Type.String(), calculation_label: Type.String(), label: Type.String(),
  input_ids: Type.Array(Type.String()), source_ids: Type.Array(Type.String()), per_tonne: Type.Object({ cost_krw: num, carbon_kgco2e: num }),
  missing_inputs: Type.Object({ cost: Type.Array(Type.String()), carbon: Type.Array(Type.String()) }),
  display: Type.Object({ net_cost_krw: str, net_carbon_kgco2e: str, cost_saving_krw: str, scenario_carbon_difference_kgco2e: str }) });
const bundleSchema = Type.Object({ cases: Type.Array(Type.Object({ case_id: Type.String(), label: Type.String() })),
  inputs: Type.Array(Type.Object({ input_id: Type.String(), source_id: str, depends_on_input_ids: Type.Array(Type.String()) })),
  sources: Type.Array(Type.Object({ source_id: Type.String() })), results: Type.Array(resultSchema),
  routes: Type.Array(Type.Object({ case_id: Type.String(), route_id: Type.String(), mass_flow: Type.Object({ input_t: num, recycling_t: num, residue_t: num }) })) });
type Bundle = Type.Static<typeof bundleSchema>;
function run(args: readonly string[], owner = script, executable = process.execPath) {
  return new Promise<{ code: number | null; out: string; err: string }>((done, reject) => {
    const child = spawn(executable, owner ? [owner, ...args] : [...args], { env: process.env, stdio: ["ignore", "pipe", "pipe"], timeout: 20000 });
    let out = "", err = "";
    child.stdout.on("data", chunk => { out += String(chunk); }); child.stderr.on("data", chunk => { err += String(chunk); });
    child.on("error", reject); child.on("close", code => done({ code, out, err }));
  });
}
async function temporary(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), "o-calculations-"));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}
async function isolated(t: TestContext) {
  const path = await temporary(t);
  const implementation = (await readPublicCalculationDataset({ root })).implementation.files;
  for (const pin of [...manifestJson.upstream, ...implementation]) {
    const target = join(path, pin.path); await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(join(root, pin.path)));
  }
  await mkdir(join(path, dataset), { recursive: true });
  await seal(path, structuredClone(fixtureJson)); return path;
}
async function seal(path: string, fixture: Fixture, reseal = true) {
  const bytes = json(fixture); await writeFile(join(path, dataset, "fixtures.json"), bytes);
  await writeFile(join(path, dataset, "manifest.json"), json({ ...manifestJson, fixture_sha256: reseal ? sha(bytes) : manifestJson.fixture_sha256 }));
}
function input(f: Fixture, id: string) { const i = f.inputs.find(i => i.input_id === id); assert.ok(i, id); return i; }
const args = (command: string, path = root) => [command, "--dataset", dataset, "--root", path, ...(command === "validate" ? [] : ["--mode", "research"])];
async function build(path = root, owner = script) {
  const result = await run(args("build", path), owner); assert.equal(result.code, 0, result.err);
  return { bytes: result.out, bundle: Value.Parse(bundleSchema, JSON.parse(result.out)) };
}
const oracleProgram = String.raw`
from decimal import Decimal as D, getcontext, ROUND_HALF_UP
import json
getcontext().prec=50
out=[]
for kg,y,p,rec,inc in [('24','1','616800','-1.04','1.24'),('18','.8','456500','-.76','1.29')]:
 m=D(kg); a=m*D(y); b=m-a
 base=m*D('10')+m*D('20')*D('.3')+m*D('99.05')
 cost=m*D('10')+(m*D('30')+b*D('20'))*D('.3')+m*D('20')+b*D('99.05')-a*D(p)/D('1000')
 carbon=(a*D(rec)+b*D('.02'))/D('.90718474')
 baseline=m*D('.02')/D('.90718474')
 for c,e in [(cost,carbon),(base,baseline),(None,m*D(inc)/D('.90718474'))]:
  vals=[c,e,None if c is None else base-c,baseline-e]
  shown=[None if v is None else format(v.quantize(D('1') if idx in (0,2) else D('.01'),rounding=ROUND_HALF_UP),'f') for idx,v in enumerate(vals)]
  out.append({'numbers':[None if v is None else str(v) for v in vals],'display':shown})
print(json.dumps(out))
`;
const oracleSchema = Type.Array(Type.Object({ numbers: Type.Array(str), display: Type.Array(str) }));
async function oracle() {
  const r = await run(["-c", oracleProgram], "", "python3"); assert.equal(r.code, 0, r.err);
  return Value.Parse(oracleSchema, JSON.parse(r.out));
}
function arithmetic(bundle: Bundle, expected: Type.Static<typeof oracleSchema>) {
  for (const [index, e] of expected.entries()) {
    const r = bundle.results[index]; assert.ok(r);
    const numbers = [r.net_cost_krw, r.net_carbon_kgco2e, r.cost_saving_krw, r.scenario_carbon_difference_kgco2e];
    for (const [i, n] of numbers.entries()) {
      const target = e.numbers[i]; assert.notEqual(target, undefined);
      if (target === null) assert.equal(n, null); else { assert.ok(n !== null); assert.ok(Math.abs(n - Number(target)) < 1e-9, `numeric oracle row ${index}/${i}: ${n} vs ${target}`); }
    }
    assert.deepEqual(Object.values(r.display), e.display);
  }
}
function commercialContract(raw: unknown) {
  const schema = Type.Object({ schema_version: Type.Literal(1), purpose: Type.Literal("commercial_reference_only"), sources: Type.Array(Type.Unknown()),
    inputs: Type.Array(Type.Unknown()), cases: Type.Array(Type.Unknown()), routes: Type.Array(Type.Unknown()), results: Type.Array(Type.Unknown()),
    exclusions: Type.Array(Type.Object({ id: Type.String(), reason: Type.String() }, { additionalProperties: false })) }, { additionalProperties: false });
  assert.ok(Value.Check(schema, raw)); const b = Value.Parse(schema, raw);
  const s = fixtureJson.sources[0]; assert.ok(s);
  const { limitations, geography, gwp, boundary, ...permittedSource } = s;
  assert.deepEqual(b.sources, [permittedSource]);
  assert.deepEqual(b.inputs, fixtureJson.inputs.filter(i => i.source_id === "KECO").map(i => {
    const { assumption_reason, gwp, boundary, ...allowed } = i; return allowed;
  }));
  const referenceIds = Value.Parse(Type.Array(Type.Object({ input_id: Type.String() })), b.inputs).map(i => i.input_id);
  assert.deepEqual(referenceIds, ["price.PET", "price.PE", "price.PP"], "commercial references retain generic PE without labelling it HDPE");
  assert.deepEqual([b.cases, b.routes, b.results], [[], [], []]);
  assert.deepEqual(b.exclusions.filter(e => e.reason === "restricted_dependency").map(e => e.id),
    fixtureJson.cases.flatMap(c => ["recycling", "landfill", "energy_recovery"].map(r => `${c.case_id}:${r}:${c.model_version}`)));
  assert.equal(b.exclusions.length, 2 + fixtureJson.inputs.filter(i => i.source_id !== "KECO").length + 9);
}
test("real research CLI retains a complete ledger, independent Decimal arithmetic, missing PP and deterministic bytes", async () => {
  const first = await build(); arithmetic(first.bundle, await oracle());
  assert.equal(first.bytes, (await build()).bytes); assert.equal(first.bundle.cases.length, 3); assert.equal(first.bundle.results.length, 9);
  assert.deepEqual(first.bundle.results.map(r => [r.net_cost_krw !== null, r.net_carbon_kgco2e !== null]),
    [[true,true],[true,true],[false,true],[true,true],[true,true],[false,true],[false,false],[false,false],[false,false]]);
  for (const c of first.bundle.cases) assert.equal(c.label,label);
  for (const r of first.bundle.results) {
    assert.equal(r.label, label); assert.equal(r.calculation_label, label);
    for (const id of r.input_ids) { const i = first.bundle.inputs.find(i => i.input_id === id); assert.ok(i); for (const dep of i.depends_on_input_ids) assert.ok(r.input_ids.includes(dep)); }
    for (const id of r.source_ids) assert.ok(first.bundle.sources.some(s => s.source_id === id));
    if (r.case_id.endsWith("003")) { assert.deepEqual([r.net_cost_krw,r.net_carbon_kgco2e,r.cost_saving_krw,r.scenario_carbon_difference_kgco2e], [null,null,null,null]); assert.deepEqual(Object.values(r.display), [null,null,null,null]); assert.deepEqual(r.per_tonne, { cost_krw: null, carbon_kgco2e: null }); assert.ok(r.missing_inputs.cost.includes("missing_mass")); }
  }
  for (const r of first.bundle.routes.filter(r => r.case_id.endsWith("003"))) assert.deepEqual(r.mass_flow, { input_t: null, recycling_t: null, residue_t: null });
});
test("implementation receipt covers the shared production modules with actual file hashes", async () => {
  const verified = await readPublicCalculationDataset({ root });
  for (const path of ["src/o-public-calculation-schema.ts", "src/o-public-calculation-data.ts",
    "src/o-public-calculation-validation.ts", "src/o-public-calculation-engine.ts", "src/o-case-research.ts"])
    assert.ok(verified.implementation.files.some(file => file.path === path));
  for (const file of verified.implementation.files) assert.equal(file.sha256, sha(await readFile(join(root, file.path))));
  assert.equal(verified.calculator_sha256, revision(verified.implementation.files));
  assert.equal(verified.implementation.sha256, verified.calculator_sha256);
});
test("importing the CLI wrapper executes no command and emits no output", async () => {
  const r = await run(["-e", `await import(${JSON.stringify(script)})`], "");
  assert.deepEqual(r, { code: 0, out: "", err: "" });
});
const mutations: readonly [string, string, (f: Fixture) => void][] = [
  ["required property", "E_REQUIRED", f => { Reflect.deleteProperty(input(f,"c"), "value"); }],
  ["false source value", "E_SOURCE_VALUE", f => { input(f,"price.PET").value = 123; }],
  ["factor unit", "E_UNIT", f => { input(f,"warm.PET.recycling").unit = "MTCO2e/metric_tonne"; }],
  ["scenario price unit", "E_UNIT", f => { input(f,"PET.price").unit = "KRW/kg"; }],
  ["blank assumption", "E_REQUIRED", f => { input(f,"PET.price").assumption_reason = " "; }],
  ["unsupported reference tax", "E_SOURCE_METADATA", f => { input(f,"price.PET").tax_basis = "VAT_included"; }],
  ["restricted grade narrative", "E_SOURCE_METADATA", f => { input(f,"price.PET").quality_grade = "WARM PET recycling -1.04"; }],
  ["restricted missing narrative", "E_SOURCE_METADATA", f => { input(f,"price.PET").missing_reason = "Wonju fee 99050"; }],
  ["reference assumption narrative", "E_SOURCE_METADATA", f => { input(f,"price.PET").assumption_reason = "WARM coefficient -1.04"; }],
  ["factor GWP", "E_GWP", f => { input(f,"warm.PET.recycling").gwp = "AR5"; }],
  ["factor boundary", "E_BOUNDARY", f => { input(f,"warm.PET.recycling").boundary = "electricity_reporting"; }],
  ["prohibited source", "E_RIGHTS_PROHIBITED", f => { const s=f.sources[1]; assert.ok(s); s.commercial_use="prohibited"; }],
  ["HDPE sourced proxy", "E_PROVENANCE", f => { input(f,"HDPE.price").source_id="KECO"; }],
  ["HDPE erased upstream", "E_PROVENANCE", f => { input(f,"HDPE.price").depends_on_input_ids=[]; }],
  ["fee erased upstream", "E_PROVENANCE", f => { input(f,"f").depends_on_input_ids=[]; }],
  ["negative rate", "E_VALUE", f => { input(f,"r").value=-1; }],
  ["negative mass", "E_VALUE", f => { input(f,"PET.mass").value=-1; }],
  ["negative allocation", "E_VALUE", f => { input(f,"PET.y").value=-.01; }],
  ["excess allocation", "E_MASS", f => { input(f,"PET.y").value=1.01; }],
  ["inconsistent mass", "E_MASS", f => { const c=f.cases[0]; assert.ok(c); c.mass_t=.1; }],
  ["source rights relabel", "E_SOURCE_METADATA", f => { const s=f.sources[1]; assert.ok(s); s.commercial_use="allowed_with_conditions"; }],
];
for (const [name, code, mutate] of mutations) test(`resealed semantic corruption rejects ${name} without stdout`, async t => {
  const path=await isolated(t), f=structuredClone(fixtureJson); mutate(f); await seal(path,f);
  const result=await run(args("build",path)); assert.equal(result.code,1); assert.equal(result.out,""); assert.equal(result.err,code+"\n");
});
test("unsealed bytes and changed original source bytes fail at their respective integrity guards", async t => {
  const path=await isolated(t), f=structuredClone(fixtureJson); input(f,"c").value=1; await seal(path,f,false);
  const fixture=await run(args("validate",path)); assert.equal(fixture.code,1); assert.equal(fixture.out,""); assert.equal(fixture.err,"E_FIXTURE_HASH\n");
  await seal(path,structuredClone(fixtureJson)); await writeFile(join(path,"data/reference/keco-price-2026-10.csv"),"changed bytes");
  const source=await run(args("validate",path)); assert.equal(source.code,1); assert.equal(source.out,""); assert.equal(source.err,"E_SOURCE_HASH\n");
});
test("explicit null sale price preserves carbon while distance changes only cost", async t => {
  const path=await isolated(t), f=structuredClone(fixtureJson), base=(await build()).bundle;
  input(f,"PET.price").value=null; input(f,"PET.price").missing_reason="scenario_price_unavailable"; input(f,"d1").value=100; await seal(path,f);
  const b=(await build(path)).bundle; assert.equal(b.results[0]?.net_cost_krw,null); assert.equal(b.results[0]?.net_carbon_kgco2e,base.results[0]?.net_carbon_kgco2e);
  assert.ok(b.results[0]?.missing_inputs.cost.includes("missing:PET.price"));
  assert.equal(b.results[3]?.net_carbon_kgco2e,base.results[3]?.net_carbon_kgco2e); assert.notEqual(b.results[3]?.net_cost_krw,base.results[3]?.net_cost_krw);
});
test("a valid resealed CLI premise experiment cannot replace the fixed case research catalog", async t => {
  const path = await isolated(t), f = structuredClone(fixtureJson);
  input(f, "c").value = 20000; await seal(path, f);
  const alternative = await readPublicCalculationDataset({ root: path });
  assert.notEqual(alternative.fixture_sha256, manifestJson.fixture_sha256);
  await assert.rejects(readCaseResearchCatalog({ root: path }), /E_FIXED_DATASET/);
});
for (const [mass,y] of [[0,0],[0,1],[.024,0],[.024,1]] as const) test(`mass ${mass} and allocation ${y} conserve mass with defined totals and per-tonne availability`, async t => {
  const path=await isolated(t), f=structuredClone(fixtureJson); input(f,"PET.y").value=y; input(f,"PET.mass").value=mass;
  input(f,"PET.mass").assumption_reason="Explicit alternative synthetic mass premise; historical original retained";
  const c=f.cases[0]; assert.ok(c); c.mass_t=mass; await seal(path,f); const b=(await build(path)).bundle;
  assert.deepEqual(b.routes[0]?.mass_flow,{input_t:mass,recycling_t:mass*y,residue_t:mass*(1-y)});
  if(mass===0) { assert.equal(b.results[0]?.net_cost_krw,0); assert.equal(b.results[0]?.net_carbon_kgco2e,0); assert.deepEqual(b.results[0]?.per_tonne,{cost_krw:null,carbon_kgco2e:null}); }
  else { const r=b.results[0]; assert.ok(r?.net_cost_krw !== null && r?.net_cost_krw !== undefined); assert.ok(Math.abs(r.net_cost_krw-(y===0 ? 3457.2 : -13867.2))<1e-9); }
});
for (const [collection, expected] of [[587799.5,"-1"],[587800.5,"1"]] as const) test(`KRW midpoint ${expected} rounds half away from zero at the serialized boundary`, async t => {
  const path=await isolated(t), f=structuredClone(fixtureJson); input(f,"c").value=collection; input(f,"PET.mass").value=1;
  const c=f.cases[0]; assert.ok(c); c.mass_t=1; await seal(path,f);
  const independent=await run(["-c",`from decimal import Decimal as D, ROUND_HALF_UP; print((D('${collection}')+D('9000')+D('20000')-D('616800')).quantize(D('1'),rounding=ROUND_HALF_UP))`],"","python3");
  assert.equal(independent.code,0,independent.err); assert.equal(independent.out.trim(),expected);
  const b=(await build(path)).bundle; assert.equal(b.results[0]?.display.net_cost_krw,independent.out.trim());
});
test("serialized exports reject numeric, dependency and label tampering; commercial export is the exact KECO projection", async t => {
  const path=await temporary(t), research=await build(), inputPath=join(path,"bundle.json"); await writeFile(inputPath,research.bytes);
  const exportArgs=["export","--dataset",dataset,"--input",inputPath,"--mode","research"];
  const valid=await run(exportArgs); assert.equal(valid.code,0,valid.err); assert.equal(valid.out,research.bytes);
  for (const change of ["number","dependency","label"]) {
    const b=Value.Parse(bundleSchema,JSON.parse(research.bytes)), r=b.results[0]; assert.ok(r);
    if(change==="number") r.net_cost_krw=7; else if(change==="dependency") r.input_ids=[]; else r.calculation_label="observed";
    await writeFile(inputPath,json(b)); const invalid=await run(exportArgs); assert.equal(invalid.code,1); assert.equal(invalid.out,""); assert.equal(invalid.err,"E_EXPORT_MISMATCH\n");
  }
  await writeFile(inputPath,research.bytes); const commercial=await run([...exportArgs.slice(0,-1),"commercial"]);
  assert.equal(commercial.code,0,commercial.err); commercialContract(JSON.parse(commercial.out));
});
test("temporary actual CLI control passes and four semantic owner mutants reach numeric or export assertions", async t => {
  const path=await isolated(t); await symlink(join(root,"node_modules"),join(path,"node_modules"));
  const engine=join(path,"src/o-public-calculation-engine.ts"), source=await readFile(engine,"utf8");
  const owner=join(path,"scripts/o-public-calculations.ts"), expected=await oracle();
  arithmetic((await build(path,owner)).bundle,expected);
  const edits=[[/1000 \/ 0\.90718474/g,"1000 / 1"],[/treatment: recycling \? b \* v\("f"\)/g,'treatment: recycling ? m * v("f")'],[/, 0\) - revenue/g,", 0) + revenue"],
    [/return item.kind === "derived" && s\?\.source_id === "KECO" && s.commercial_use === "allowed_with_conditions" && s.redistribution === "allowed_with_conditions";/g,"return true;"]] as const;
  for (const [index,[pattern,replacement]] of edits.entries()) {
    const mutant=source.replace(pattern,replacement); assert.notEqual(mutant,source); await writeFile(engine,mutant);
    const b=await build(path,owner);
    if(index<3) assert.throws(()=>arithmetic(b.bundle,expected),assert.AssertionError);
    else { const inputPath=join(path,"mutant-bundle.json"); await writeFile(inputPath,b.bytes);
      const r=await run(["export","--root",path,"--dataset",dataset,"--input",inputPath,"--mode","commercial"],owner);
      assert.equal(r.code,0,r.err); assert.throws(()=>commercialContract(JSON.parse(r.out)),assert.AssertionError); }
  }
});
test("validation is explicit about private evidence and operations preserve original source bytes", async t => {
  const before=await Promise.all(manifestJson.upstream.map(p=>readFile(join(root,p.path)).then(sha)));
  assert.deepEqual(before,manifestJson.upstream.map(p=>p.sha256));
  const valid=await run(args("validate")); assert.equal(valid.code,0,valid.err);
  const path=await temporary(t), missing=await run([...args("validate"),"--evidence-dir",path]); assert.equal(missing.code,1); assert.equal(missing.out,"");
  for(const pin of manifestJson.private_evidence) await writeFile(join(path,pin.path),"wrong private original");
  const mismatch=await run([...args("validate"),"--evidence-dir",path]); assert.equal(mismatch.code,1); assert.equal(mismatch.out,""); assert.equal(mismatch.err,"E_SOURCE_HASH\n");
  await build(); assert.deepEqual(await Promise.all(manifestJson.upstream.map(p=>readFile(join(root,p.path)).then(sha))),before);
  const usage=await run(["build","--dataset",dataset]); assert.equal(usage.code,2); assert.equal(usage.out,""); assert.equal(usage.err,"E_USAGE\n");
});
