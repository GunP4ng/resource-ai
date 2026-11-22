import type { CaseInput } from "./contracts.ts";
import { safetyReasons } from "./o-safety-reasons.ts";
import { isUnknownCaseText } from "./o-validation.ts";

export type MaterialFamily = "metal" | "wood" | "paper" | "packaging";
export type MaterialStream = "ferrous" | "nonferrous" | "wood-byproduct" | "wood-packaging" | "paper" | "carton";

const oilTerms = "(?:오일|기름|유류|절삭유|윤활유|작동유|유압유|그리스|유분)";
// Match lead as a substance, not ordinary words such as 납품, 수납 or 납작.
const nonOilTerms = "(?:절삭액|냉각수|방청제|도금|카드뮴|크롬|석면|중금속|납땜|땜납|\\bPCB\\b|(?<![가-힣A-Za-z])납"
  + "(?=$|[^가-힣A-Za-z]|(?:함유|성분|검출|오염|부착|잔류)|(?:이|은|을|과|도|의|에|으로)(?=$|[^가-힣A-Za-z])))";
const residueTerms = "(?:잔류(?:물|막)?|잔여물|찌꺼기|얼룩|부착물|묻음|끈적(?:임)?|슬러지|분진|이물(?:질)?"
  + "|(?<![가-힣A-Za-z])막(?=$|[^가-힣A-Za-z]|(?:이|은|을|과|도|의|에)(?=$|[^가-힣A-Za-z])))";
const denialTerms = `(?:도료|도장|페인트|방부(?:처리|제|목)?|접착(?:제)?|${oilTerms}|${nonOilTerms}|${residueTerms}|유해물질|오염|약제|약품|표면처리|코팅|비닐|테이프|플라스틱|복합층|복합재|라미네이트|알루미늄|PET|HDPE|LDPE|PP|PE|PS|PVC|ABS)`;
const materialDenial = new RegExp(`(?:^|[,;.\\n])\\s*${denialTerms}(?:\\s*[·ㆍ/,]\\s*${denialTerms})*\\s*(?:처리|접촉|오염|사용|잔류)?\\s*(?:이|가)?\\s*(?:없음|없습니다|없다|하지\\s*않음|아님)(?=\\s*(?:[,;.\\n]|$))`, "giu");
const materialHazard = new RegExp(`도료|도장|페인트|방부|접착|${oilTerms}|${nonOilTerms}|크레오소트|할로겐|\\b(?:paint(?:ed)?|preservative|oil(?:y)?|treated|adhesive|creosote)\\b`, "iu");
const unresolvedMaterialHistory = new RegExp(`${residueTerms}|잔존|부착|묻[은어]|오염|약제|약품|처리|피막|\\b(?:residu\\w*|treatment|coated)\\b`, "iu");

const unplatedFields = new Set(["무도금", "무도금 구리판", "무도금 구리판 절단편"]);
const coatingSignal = /도금|코팅|도료|도장|페인트/u;

/** Like maskExplicitHazardDenial, mask complete clauses in one field, never adjoining assertions. */
function maskMaterialDenials(value: string | null): string {
  return (value ?? "").normalize("NFKC").replace(materialDenial, ",")
    .replace(/(?:^|[,;.\n])\s*(?:없음|무오염|깨끗|청정|none|clean)(?=\s*(?:[,;.\n]|$))/giu, ",")
    .replace(/(?:^|[,;.\n])\s*(?:no|without)\s+(?:paint|preservatives?|oil|adhesives?)(?=\s*(?:[,;.\n]|$))/giu, ",");
}

/** Reported absence only. Unrecognized or affirmative remainder cannot establish clean context. */
export function isDeclaredCleanMaterial(value: string | null, family: MaterialFamily): boolean {
  const original = (value ?? "").normalize("NFKC");
  const masked = maskMaterialDenials(original);
  return masked !== original && masked.split(/[,;.\n]/u).every(clause => {
    const text = clause.replace(/\s+/gu, "");
    return text === "" || /^(?:(?:건조하고)?깨끗(?:함)?|청정|무오염|clean|(?:단일재질로)?분리보관)$/iu.test(text)
      || (family === "wood" && /^(?:무처리|미처리)(?:원목|목재)상태$/u.test(text));
  });
}

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
      .some(match => isUnknownCaseText(match[1], "clause")))) return null;
  if (/건설폐기물|분진|슬러지|오니|배터리|축전지|폐전선|전자제품|광재/iu.test([input.process, input.description].map(maskMaterialDenials).join(" "))) return null;
  const material = canonicalMaterial(input.polymer);
  if (material === null) return null;
  if (["paper", "cardboard", "paper-packaging", "uncoated-paper"].includes(material)) {
    return (material === "uncoated-paper" || /무코팅|비코팅|\buncoated\b/iu.test(input.description))
      && !reported.some(value => /코팅|테이프|복합|라미네이트|알루미늄|비닐|플라스틱|\b(?:coated|PET|HDPE|LDPE|PP|PE|PS|PVC|ABS)\b/iu.test(
        maskMaterialDenials(value).replace(/무코팅|비코팅|\buncoated\b/giu, ""))) ? "paper" : null;
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
export function materialHazardTerms(input: CaseInput): readonly string[] {
  if (materialFamily(input) === null) return [];
  const fields = [input.polymer, input.description, input.process, input.contamination];
  const unplated = fields.map(value => unplatedFields.has((value ?? "").normalize("NFKC").trim()));
  const masked = fields.map(maskMaterialDenials);
  // Retain the original hazard scan when any independent coating signal remains.
  const withoutUnplated = masked.map((value, index) => unplated[index] ? "" : value);
  const hazardFields = withoutUnplated.some(value => coatingSignal.test(value)) ? masked : withoutUnplated;
  return [...new Set(hazardFields.flatMap(value =>
    [...value.replace(/\b(?:unpainted|untreated|oil-free)\b/giu, "")
      .matchAll(new RegExp(materialHazard.source, "giu"))].map(match => match[0])))];
}

export function materialHazardReasons(input: CaseInput): readonly string[] {
  return materialHazardTerms(input).length ? [safetyReasons.materialTreatment] : [];
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
  if (family === "metal" && /건설폐기물|분진|슬러지|오니|배터리|축전지|폐전선|전자제품|광재/iu.test([input.process, input.description].map(maskMaterialDenials).join(" "))) {
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
  const unresolvedHistory = [input.description, input.process].some(value => {
    const remainder = maskMaterialDenials(value)
      .replace(/(?:무처리|미처리|\buntreated\b)(?![^,;.\n]*(?:미상|미확인|불명|모름|추정|아님|아닌|unknown))/giu, "");
    if (unresolvedMaterialHistory.test(remainder)) return true;
    const observation = /^(?:(.+?)[ \t]*,[ \t]*)?잔여[ \t]+물질[ \t]+있음$/u
      .exec((value ?? "").normalize("NFKC").trim());
    if (observation === null) return false;
    const fullPrefix = observation[1];
    if (fullPrefix === undefined || canonicalMaterial(fullPrefix) !== null) return true;
    const base = /^(.+?)[ \t]+스크랩$/u.exec(fullPrefix);
    return base !== null && canonicalMaterial(base[1]) !== null;
  });
  if ((unresolvedHistory || (input.contamination?.trim() && !isDeclaredCleanMaterial(input.contamination, family)))
    && materialHazardReasons(input).length === 0) questions.push(safetyReasons.contaminationUnknown);
  return questions;
}
