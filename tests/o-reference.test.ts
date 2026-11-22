import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.ts";

const origin = "http://localhost:3000";

test("native reference route shows exactly three national purchase statistics with their grades and provenance", async () => {
  const app = createApp({ origin });
  const response = await app(new Request(`${origin}/reference`));
  assert.equal(response.status, 200);
  const rows: string[][] = [];
  const links: (string | null)[] = [];
  let section = "";

  await new HTMLRewriter()
    .on("#material-purchase-prices", { text(chunk) { section += chunk.text; } })
    .on("#material-purchase-prices tbody tr", { element() { rows.push([]); } })
    .on("#material-purchase-prices tbody td", {
      element() { rows.at(-1)?.push(""); },
      text(chunk) {
        const row = rows.at(-1);
        if (row && row.length > 0) row[row.length - 1] += chunk.text;
      },
    })
    .on("#material-purchase-prices a", { element(element) { links.push(element.getAttribute("href")); } })
    .transform(response).text();

  assert.deepEqual(rows.map(row => row.slice(0, 2).map(cell => cell.trim())), [
    ["철스크랩 · 경량 B급 · 스크랩 상태의 고철", "346.1 원/kg"],
    ["폐신문지 · 상･중･하 중 중품 · 건조･선별된 상태", "125.8 원/kg"],
    ["폐골판지 · 상･중･하 중 중품 · 라이너 형태 고지", "93.5 원/kg"],
  ]);
  for (const [index, locator] of [
    [0, "PDF 물리 60쪽 / 인쇄 56쪽 · 2026.10 행, 전국 열"],
    [1, "PDF 물리 16쪽 / 인쇄 12쪽 · 2026.10 행, 전국 열"],
    [2, "PDF 물리 18쪽 / 인쇄 14쪽 · 2026.10 행, 전국 열"],
  ] as const) assert.ok(rows[index]?.[2]?.includes(locator), locator);
  for (const field of ["기준월 2026년 10월", "조사 기준일 2026년 10월 10일", "공표일 2026년 10월 26일", "조회일 2026년 11월 22일", "전국", "VAT 포함", "물류비 제외", "실제 견적이 아닙니다",
    "52df7721b44db3f3053bc2fc9f4bdd32f01e3ef8a59dcacee79f88d4bac9c1e0",
    "562bf85c2f9a2047649b52d9875da462fdb2ca14be36e21cfd1950ff976dfeb3"]) {
    assert.ok(section.includes(field), field);
  }
  assert.ok(links.includes("https://www.re.or.kr/info/listCirPricePage.do?toSn=142"));
  assert.ok(links.includes("https://www.data.go.kr/data/3076421/fileData.do"));
});

test("verified purchase-price scope stays separate from unchanged plastics VAT and logistics uncertainty", async () => {
  const app = createApp({ origin });
  const response = await app(new Request(`${origin}/reference`));
  const html = await response.text();
  const verified = html.match(/<section id="material-purchase-prices"[^>]*>([\s\S]*?)<\/section>/)?.[1];

  assert.ok(verified);
  assert.match(verified, /중간가공업체의 고철 스크랩\(경량 B급\) 매입 가격/);
  assert.match(verified, /중간가공업체의 미압축 고지 매입 가격/);
  assert.doesNotMatch(verified, /VAT·물류 미확인|참고 매각가격/);
  assert.match(html, /<h2>참고 매각가격<\/h2><p>참고가격 · 부가세·물류 별도 확인<\/p>/);
  assert.match(html, /136개 가격 · 공란은 미발표/);
  assert.match(html, /압축-PE\(잡색\)/);
});

test("excluded materials remain unavailable and reference statistics expose no case-application controls", async () => {
  const app = createApp({ origin });
  const response = await app(new Request(`${origin}/reference?massKg=1000&material=copper`));
  let unavailable = "";
  let applicationControls = 0;
  let section = "";

  await new HTMLRewriter()
    .on("#material-purchase-prices", { text(chunk) { section += chunk.text; } })
    .on("#material-purchase-prices li", { text(chunk) { unavailable += chunk.text; } })
    .on("#material-purchase-prices form, #material-purchase-prices input, #material-purchase-prices button, #material-purchase-prices a[href^='/cases']", {
      element() { applicationControls++; },
    }).transform(response).text();

  for (const material of ["구리", "폐목재", "종이팩"]) assert.match(unavailable, new RegExp(`${material}[^\\n]*미확보`));
  assert.equal(applicationControls, 0);
  assert.match(section, /사용자 사례에 등급·가격을 적용하지 않습니다/);
  assert.doesNotMatch(section, /346,100|125,800|93,500|1000\s*kg/);
});
