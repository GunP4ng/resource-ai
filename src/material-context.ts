import type { CaseInput } from "./contracts.ts";
import { safetyReasons } from "./o-safety-reasons.ts";
import { isUnknownCaseText } from "./o-validation.ts";

export type MaterialFamily = "metal" | "wood" | "paper" | "packaging";
export type MaterialStream = "ferrous" | "nonferrous" | "wood-byproduct" | "wood-packaging" | "paper" | "carton";

const materialAliases = {
  PP: ["pp", "폴리프로필렌", "polypropylene"],
  PE: ["pe", "폴리에틸렌", "polyethylene"],
  PET: ["pet", "폴리에틸렌테레프탈레이트", "polyethylene terephthalate"],
  HDPE: ["hdpe", "고밀도 폴리에틸렌", "high density polyethylene", "high-density polyethylene"],
  LDPE: ["ldpe", "저밀도 폴리에틸렌", "low density polyethylene", "low-density polyethylene"],
  PS: ["ps", "폴리스티렌", "polystyrene"],
  EPS: ["eps", "발포 폴리스티렌", "expanded polystyrene"],
  PVC: ["pvc", "폴리염화비닐", "폴리비닐클로라이드", "polyvinyl chloride"],
  ABS: ["abs", "아크릴로니트릴부타디엔스티렌", "acrylonitrile butadiene styrene"],
  PA: ["pa", "폴리아미드", "폴리아마이드", "polyamide", "나일론", "nylon"],
  PC: ["pc", "폴리카보네이트", "polycarbonate"],
  metal: ["금속", "금속 스크랩", "metal", "metal scrap"],
  ferrous: ["고철", "철스크랩", "철 스크랩", "철", "강철", "steel", "iron", "ferrous scrap", "ferrous metal"],
  nonferrous: ["비철금속", "비철 금속", "비철 스크랩", "nonferrous scrap", "non-ferrous scrap", "nonferrous metal", "non-ferrous metal"],
  aluminum: ["알루미늄", "aluminum", "aluminium"],
  copper: ["구리", "copper"],
  wood: ["폐목재", "목재", "원목", "톱밥", "대패밥", "wood", "waste wood", "lumber", "sawdust", "wood shavings"],
  "untreated-wood": ["무처리 목재", "미처리 목재", "무처리 폐목재", "미처리 폐목재", "무처리 원목", "미처리 원목", "untreated wood", "untreated waste wood", "untreated lumber"],
  "wood-packaging": ["폐목재포장재", "목재 포장재", "원목 팔레트", "wood packaging", "wooden packaging", "wood pallet"],
  "untreated-wood-packaging": ["무처리 폐목재포장재", "무처리 목재 포장재", "무처리 원목 팔레트", "untreated wood packaging", "untreated wooden packaging", "untreated wood pallet"],
  paper: ["폐종이류", "폐지", "종이", "paper", "waste paper"],
  cardboard: ["골판지", "판지", "cardboard", "corrugated cardboard"],
  "paper-packaging": ["종이 포장재", "paper packaging"],
  "uncoated-paper": ["무코팅 폐종이류", "무코팅 폐지", "무코팅 종이", "무코팅 골판지", "무코팅 종이 포장재", "uncoated paper", "uncoated cardboard", "uncoated paper packaging"],
  "beverage-carton": ["종이팩", "복합 종이팩", "음료용 종이팩", "beverage carton", "milk carton"],
  carton: ["carton"],
  packaging: ["포장재", "복합 포장재", "packaging", "composite packaging"],
} as const;

/** Exact reported names only; parentheses must name the same material on both sides. */
export function canonicalMaterial(value: string | null | undefined): string | null {
  const key = (value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
  const exact = (part: string): string | null => {
    for (const [name, aliases] of Object.entries(materialAliases)) {
      if (aliases.some(alias => alias.replace(/\s+/gu, "") === part)) return name;
    }
    return null;
  };
  const direct = exact(key);
  if (direct !== null) return direct;
  const single = /^(?:단일)?(.+?)(?:\(다층아님\)|non-?mixed)$/u.exec(key);
  const singleResin = single ? exact(single[1] ?? "") : null;
  if (singleResin !== null && /^[A-Z]+$/u.test(singleResin)) return singleResin;
  const pair = /^([^()]+)\(([^()]+)\)$/u.exec(key);
  if (!pair) return null;
  const outer = exact(pair[1] ?? "");
  return outer !== null && outer === exact(pair[2] ?? "") ? outer : null;
}

/** A reported family selects questions, never a legal code or an approved route. */
export function materialFamily(input: Pick<CaseInput, "polymer" | "description">): MaterialFamily | null {
  const material = canonicalMaterial(input.polymer);
  if (material !== null) {
    if (["metal", "ferrous", "nonferrous", "aluminum", "copper"].includes(material)) return "metal";
    if (["wood", "untreated-wood", "wood-packaging", "untreated-wood-packaging"].includes(material)) return "wood";
    if (["paper", "cardboard", "paper-packaging", "uncoated-paper", "beverage-carton", "carton"].includes(material)) return "paper";
    if (material === "packaging") return "packaging";
    return null;
  }
  const reported = isUnknownCaseText(input.polymer) ? undefined : input.polymer?.normalize("NFKC").trim();
  const text = reported || input.description;
  if (reported && /폐지|종이|골판지|paper|cardboard|carton/iu.test(reported)) return "paper";
  if (/\b(?:PET|HDPE|LDPE|PP|PE|PS|PVC|ABS|PC|PA)\b|플라스틱|합성수지|비닐/iu.test(text)) return null;
  if (!reported && /(?:재질|소재|수지)\s*(?:미상|미확인|불명|모름)|\b(?:unknown material|material unknown)\b/iu.test(text)) return null;
  for (const [family, pattern] of [
    ["metal", /금속|고철|철\s*스크랩|알루미늄|구리|\b(?:metal|steel|iron|aluminum|aluminium|copper)\b/giu],
    ["wood", /폐목재|목재|원목|톱밥|대패밥|\b(?:wood|lumber|sawdust)\b/giu],
    ["paper", /폐지|종이|골판지|\b(?:paper|cardboard|carton)\b/giu],
    ["packaging", /포장재|\bpackaging\b/giu],
  ] as const) {
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(0, match.index);
      const after = text.slice(match.index + match[0].length);
      if (/\b(?:not|no)\s*$/iu.test(before.slice(-12)) || /^\s*(?:이|가)?\s*(?:아닌|아님|아니다|아니라)/u.test(after)) continue;
      if (!reported && (
        (match[0] === "종이" && /^[ \t]+라벨이[ \t]+붙은[ \t]+(?:[^,.\r\n]+[ \t]+)?용기[ \t]+파쇄품[ \t]*(?=[,.]|$)/u.test(after))
        || (match[0] === "금속" && /하우징[ \t]+파쇄품[ \t]*,[ \t]*$/u.test(before)
          && /^[ \t]+나사[ \t]+제거\s*\.?\s*$/u.test(after))
      )) continue;
      return family;
    }
  }
  return null;
}

export function materialStream(input: CaseInput): MaterialStream | null {
  if (isUnknownCaseText(input.polymer)) return null;
  const reported = [input.polymer, input.description, input.process, input.contamination]
    .map(value => (value ?? "").normalize("NFKC"));
  if (!/사업장\s*일반|industrial general/iu.test(input.process ?? "")
    || /아님|아니|않|\b(?:not|no)\b/iu.test(input.process ?? "")) return null;
  if (reported.some(value =>
    /(?:무처리|미처리|무코팅|비코팅)[^,.;\n]{0,12}(?:아님|아닌)|\bnot\s+(?:untreated|uncoated)\b/iu.test(value)
    || [...value.matchAll(/(?:무처리|미처리|무코팅|비코팅|처리\s*이력|코팅\s*이력|treatment\s+history|coating\s+history)\s*(?:여부|이력|유무)?\s*(?:은|는|이|가)?\s*[:：]?\s*([^,.;\n]+)/giu)]
      .some(match => isUnknownCaseText(match[1])))) return null;
  if (/건설폐기물|분진|슬러지|오니|배터리|축전지|폐전선|전자제품|광재/iu.test([input.process, input.description].join(" "))) return null;
  const material = canonicalMaterial(input.polymer);
  if (material === null) return null;
  if (["paper", "cardboard", "paper-packaging", "uncoated-paper"].includes(material)) {
    return (material === "uncoated-paper" || /무코팅|비코팅|\buncoated\b/iu.test(input.description))
      && !reported.some(value => /복합|라미네이트|알루미늄|비닐|플라스틱|\b(?:PET|HDPE|LDPE|PP|PE|PS|PVC|ABS)\b/iu.test(value)) ? "paper" : null;
  }
  if (material === "beverage-carton") {
    return /우유|음료|식품/u.test(input.process ?? "")
      && /폴리에틸렌|\bPE\b/iu.test(input.description) ? "carton" : null;
  }
  if (material === "ferrous") return "ferrous";
  if (["nonferrous", "aluminum", "copper"].includes(material)) return "nonferrous";
  if (materialFamily(input) !== "wood") return null;
  if (!material.startsWith("untreated-") && !/무처리|미처리|\buntreated\b|원목\s*상태/iu.test([input.process, input.contamination].join(" "))) return null;
  if (/원목\s*(?:제재|가공)|제재소|sawmill|lumber mill/iu.test(input.process ?? "")) return "wood-byproduct";
  if (["wood-packaging", "untreated-wood-packaging"].includes(material)
    && /포장|팔레트/iu.test(input.process ?? "")) return "wood-packaging";
  return null;
}

/** Keep affirmative risk in each field even when another field denies contact. */
export function materialHazardReasons(input: CaseInput): readonly string[] {
  if (materialFamily(input) === null) return [];
  const risk = [input.polymer, input.description, input.process, input.contamination].some(value => {
    const text = (value ?? "")
      .replace(/(?:도료|도장|페인트|방부(?:처리|제)?|접착제|오일|기름|유류|유해물질)(?:\s*[·ㆍ/,]\s*(?:도료|도장|페인트|방부(?:처리|제)?|접착제|오일|기름|유류|유해물질))*\s*(?:처리|접촉|오염|사용|잔류)?\s*(?:이|가)?\s*(?:없음|없습니다|없다|하지\s*않음|아님)/gu, "")
      .replace(/\b(?:no|without)\s+(?:paint|preservatives?|oil|adhesives?)\b/giu, "")
      .replace(/\b(?:unpainted|untreated|oil-free)\b/giu, "");
    return /도료|도장|페인트|방부|접착제|오일|기름|유류|크레오소트|할로겐|\b(?:paint(?:ed)?|preservative|oil(?:y)?|treated|adhesive|creosote)\b/iu.test(text);
  });
  return risk ? [safetyReasons.materialTreatment] : [];
}

export function materialQuestions(input: CaseInput): readonly string[] {
  const family = materialFamily(input);
  if (family === null) return [];
  const questions: string[] = [];
  const material = input.polymer?.trim() ?? "";
  if (!/사업장\s*일반|industrial general/iu.test(input.process ?? "")) {
    questions.push("발생 공정 입력란에 사업장일반폐기물 해당 여부와 실제 발생원을 알려 주세요. 생활·건설·지정폐기물 여부에 따라 분류가 달라집니다.");
  }
  if (family === "metal" && !["ferrous", "nonferrous", "aluminum", "copper"].includes(canonicalMaterial(material) ?? "")) {
    questions.push("철·비철 구분과 정확한 금속 품목을 알려 주세요. 금속캔·용기, 분진·슬러지 또는 혼합물은 별도 분류 근거가 필요합니다.");
  }
  if (family === "metal" && /건설폐기물|분진|슬러지|오니|배터리|축전지|폐전선|전자제품|광재/iu.test([input.process, input.description].join(" "))) {
    questions.push("별도 분류 대상 발생물의 구체적 발생원·성분·유해성을 확인해 주세요. 일반 금속 스크랩 코드로 추정하지 않습니다.");
  }
  if (family === "wood" && materialStream(input) === null) {
    questions.push("원목 제재·가공 부산물인지 사용한 포장재·가구·건설 목재인지 알려 주세요. 도장·접착·방부·오일 처리 이력도 확인해 주세요.");
  }
  if (family === "wood" && !/무처리|미처리|\buntreated\b|원목\s*상태/iu.test([material, input.process, input.contamination].join(" "))) {
    questions.push("목재의 도장·접착·방부·오일 처리가 없다는 이력 자료가 있나요? 오염 없음만으로 무처리 목재를 확정하지 않습니다.");
  }
  if (family === "paper" && materialStream(input) === null) {
    questions.push("종이의 코팅·복합층과 용도를 확인해 주세요. 무코팅 폐종이류인지, 식품·음료용 PE 복합 종이팩인지 알려 주세요.");
  }
  if (family === "packaging") {
    questions.push("포장재의 구성 재질과 층별 구성, 분리 가능 여부를 알려 주세요. 종이·금속·플라스틱 또는 복합재인지 확인하기 전에는 분류 코드와 재활용 유형을 추정하지 않습니다.");
  }
  if (materialStream(input) !== "carton" && /혼합|복합|합판|MDF|파티클|particle|plywood|\bmixed\b/iu.test(material)) {
    questions.push("구성 재질·접착제·코팅과 분리 가능 여부를 확인해 주세요. 혼합·가공 재료를 깨끗한 단일 재질로 간주하지 않습니다.");
  }
  return questions;
}
