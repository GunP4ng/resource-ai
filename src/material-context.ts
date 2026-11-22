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
const excludedStream = /건설폐기물|분진|슬러지|오니|배터리|축전지|폐전선|전자제품|광재/iu;
const physicalLineBoundary = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/u;
const treatmentDenials = new Set(["오일 안 묻음", "방부 미처리", "무도장", "미도장", "오일 미사용", "방부제 미사용"]);
const standaloneClean = /^(?:오염 ?)?없(?:음|습니다|다)$/u;

function treatmentAssertions(value: string | null, family: MaterialFamily): readonly string[] | null {
  if (family !== "metal" && family !== "wood") return null;
  const assertions = (value ?? "").split(physicalLineBoundary).flatMap(line => line.split(","))
    .map(assertion => assertion.replace(/[\p{Zs}\t]+/gu, " ").replace(/^ | $/gu, "")).filter(Boolean);
  return assertions.some(assertion => treatmentDenials.has(assertion)) ? assertions : null;
}

function onlyCleanAssertions(assertions: readonly string[]): boolean {
  return assertions.every(assertion => treatmentDenials.has(assertion) || standaloneClean.test(assertion));
}

function explicitlyUntreatedWood(material: string | null): boolean {
  return material === "untreated-wood" || material === "untreated-wood-packaging";
}

/** Like maskExplicitHazardDenial, mask complete clauses in one field, never adjoining assertions. */
function maskMaterialDenials(value: string | null): string {
  return (value ?? "").normalize("NFKC").replace(materialDenial, ",")
    .replace(/(?:^|[,;.\n])\s*(?:없음|무오염|깨끗|청정|none|clean)(?=\s*(?:[,;.\n]|$))/giu, ",")
    .replace(/(?:^|[,;.\n])\s*(?:no|without)\s+(?:paint|preservatives?|oil|adhesives?)(?=\s*(?:[,;.\n]|$))/giu, ",");
}

/** Reported absence only. Unrecognized or affirmative remainder cannot establish clean context. */
export function isDeclaredCleanMaterial(input: CaseInput, family: MaterialFamily): boolean {
  const assertions = treatmentAssertions(input.contamination, family);
  if (assertions !== null) {
    if (!onlyCleanAssertions(assertions)) return false;
    // A standalone absence on another line cannot clear a reported residue.
    const factualLines = [input.process, input.description].flatMap(value => (value ?? "").split(physicalLineBoundary));
    if (factualLines.some(line => excludedStream.test(maskMaterialDenials(line)) || hasUnresolvedMaterialHistory(line))) return false;
    const stream = materialStream(input);
    const supported = family === "wood"
      ? explicitlyUntreatedWood(canonicalMaterial(input.polymer)) && (stream === "wood-byproduct" || stream === "wood-packaging")
      : stream === "ferrous" || stream === "nonferrous";
    return supported && stream === supportedMaterialStream(input, "없음") && !scanMaterialHazards(input).hold;
  }
  const original = (input.contamination ?? "").normalize("NFKC");
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
  return supportedMaterialStream(input, input.contamination);
}

type ReportedOrigin = "affirmed" | "denied" | "unconfirmed";
type OriginClause = { subject: "category"; answer: ReportedOrigin }
  | { subject: "implicit"; answer: ReportedOrigin }
  | { subject: "independent" }
  | { subject: "other" };

// Subject and answer vocabularies describe classification, not generating processes.
const koreanCaseParticle = "(?:(?:에서|에|(?:으)?로(?:서|써)?)(?:까지|부터)?(?:만|도)?(?:은|는)?|은|는|이|가|만|도)";
const koreanFraming = "(?:아직(?:도|은)?|현재(?:로서는|는)?|지금(?:까지|은)?|당장은|일단|[가-힣]{1,12}적으로)";
const koreanOriginSubject = String.raw`(?:${koreanFraming} ){0,2}(?:폐기물 ?)?(?:해당 ?여부|여부|분류(?: ?상태)?|종류|해당 ?상태|발생 ?구분)${koreanCaseParticle}?(?=$|[ :])`;
const finiteBe = "(?:am|is|are|was|were)";
const perfectAuxiliary = "(?:has|have|had)";
const remain = "remain(?:s|ed)?";
const statusAdverb = "(?:currently|still|already|now|previously|just)";
const originLinkVerb = `(?:${finiteBe}|${remain}|${perfectAuxiliary}(?: (?:${statusAdverb}|not|never|yet)){0,3} (?:been|remained))`;
const framedOriginLink = `(?:${statusAdverb} ){0,2}${originLinkVerb}`;
const finalClassificationSubject = String.raw`final classification(?: status)?(?= *:| ${framedOriginLink}\b|$)`;
const englishOriginSubject = String.raw`(?:(?:currently|still|now|[a-z]{2,20}ly) ){0,2}(?:(?:the|its|this|that|their|our) )?(?:(?:current|waste|origin|category|legal) )?(?:${finalClassificationSubject}|classification(?: status)?|applicability|category|designation|origin status)\b`;
const namedOrigin = `(?:${koreanOriginSubject}|${englishOriginSubject})`;
const originSubject = new RegExp(`^${namedOrigin}(?: *: *)? *`, "u");
const originAnswer: Record<ReportedOrigin, RegExp> = {
  affirmed: /^(?:(?:해당|확인|분류)(?:됨|입니다|이다|됩니다|(?:되었|됐)(?:음|습니다|다)|으로 확인됨)?|맞(?:음|습니다|다)|예|네|(?:yes|applicable|confirmed|verified|classified|completed?))$/u,
  denied: /^(?:(?:비해당|해당 ?없음)(?:입니다|이다)?|해당(?:하지|되지) ?않(?:음|습니다|다)|아(?:님|니다|닙니다|니라고 ?확인됨|니요)|(?:no|not applicable|does not apply|denied))$/u,
  unconfirmed: /^(?:(?:미확인|미상|불명|미정|미분류|모름|추정|가정|확인 중|확인 필요|확인 전|확인되지 않음|대기)(?:입니다|이다|임|인 상태)?|(?:unknown|unconfirmed|unverified|uncertain|pending|undetermined|unclassified|not (?:yet )?(?:confirmed|verified)|awaiting (?:confirmation|verification)))$/u,
};
const independentSubject = /(?<![\p{L}\p{N}])(?:(?:작업 ?)?시간|시각|일정|교대|수거(?: ?일정)?|픽업|오염(?: ?여부)?|(?:표면 )?(?:약제 )?(?:처리|코팅) ?이력)(?:은|는|이|가)?(?=$|[ :])|\b(?:(?:work|production) (?:time|schedule)|time|shift|pickup|collection|contamination)(?: status)?\b/u;
const implicitOriginCue = /^(?:[:?/]|또는|혹은|아닌|만약|가정|추정|분류|확인|해당|비해당|(?:or|either|if|whether|may|might|possibly|probably|maybe|presumed|assumed|suspected|tentatively|unconfirmed|unverified|unknown|uncertain|pending|undetermined|unclassified|awaiting|under review|for review|questionable|not (?:yet )?(?:confirmed|verified)|classified)\b)|(?:인지|맞는지|인 경우|라고 가정)(?: |$)|(?:^| )(?:미확인|미상|불명|미정)(?:입니다|임|이다)?(?: |$)/u;
const tentative = "(?:possibly|probably|maybe|presumed|assumed|suspected|tentatively)";
const fixedPassiveModifier = "(?:not|never|already|ever|still|yet|first|then|soon|now|again|more|less|just|even|also|maybe|presumed|assumed|suspected)";
const passiveModifier = `(?:${fixedPassiveModifier}|[a-z]{2,20}ly)`;
const passiveModifiers = `(?: ${passiveModifier}){0,4}`;
const finiteModal = "(?:may|might|can|could|must|should|shall|will|would|cannot)";
const modal = `(?:${finiteModal}|to)`;
const passiveAuxiliary = String.raw`\b(?:(?:${tentative} )?(?:(?<modal>${modal})${passiveModifiers} (?:be|have${passiveModifiers} been)|(?<finite>${finiteBe}|${perfectAuxiliary}${passiveModifiers} been))|${passiveModifier}${passiveModifiers} (?:be|been))${passiveModifiers}`;
const participle = "[a-z]+(?:-[a-z]+)*";
const infinitivalPassive = String.raw`to${passiveModifiers} (?:be|have${passiveModifiers} been)\b`;
const finitePredicate = String.raw`(?:${finiteBe}|${perfectAuxiliary}|${remain}|${finiteModal}${passiveModifiers} (?:be|have))\b`;
// A prepositional complement ends at the next auxiliary or embedded passive.
const prepositionalComplement = String.raw`(?: (?!${infinitivalPassive})(?:at|in|on|near|inside|outside|within|under|by|from|to|for|with|without|after|before|during|about|against|of|over|through)(?: (?!${finitePredicate}|${infinitivalPassive})${participle})+)?`;
const participialPredicate = `${participle}(?: [a-z]{2,20}ly){0,2}${prepositionalComplement}`;
const localPassive = new RegExp(`${passiveAuxiliary}$`, "u");
const sharedPassive = new RegExp(`${passiveAuxiliary}(?= ${participialPredicate}$)`, "u");
const participleTail = new RegExp(`(?:^| )${participialPredicate}$`, "u");
const trailingPassiveModifiers = new RegExp(String.raw`\b${passiveModifier}${passiveModifiers}$`, "u");
const modifiersBeforeAuxiliary = new RegExp(`^${fixedPassiveModifier}(?: ${fixedPassiveModifier}){0,3}$`, "u");
const uncertainCompletion = new RegExp(String.raw`\b(?:${tentative}|never)\b|\bnot (?:[a-z]+ ){0,3}(?:yet|already)\b`, "u");
const legacyOriginNegation = /아님|아니|않|\b(?:not|no)\b/iu;
const koreanCategoryParticle = new RegExp(
  String.raw`^${koreanCaseParticle}(?=$|[ :?]|아(?:님|닙니다|니)|분류|해당|여부|확인|미상)`, "u");
const originPredicatePrefix = new RegExp(
  String.raw`^(?:${framedOriginLink}(?: |$))?(?:(?:${statusAdverb}|${koreanFraming})(?: |$)){0,2}`, "u");
const statusLabel = /^status *: */u;
const explicitFactSubject = `(?=${namedOrigin}|${independentSubject.source})`;
const koreanAdversative = `이나 +${explicitFactSubject}`;
const leadingKoreanAdversative = new RegExp(`^${koreanAdversative}`, "u");
const coordinatedFacts = new RegExp(
  String.raw` +(?:and|및) +|(?:^| +)but +${explicitFactSubject}|(?:^|(?<=[가-힣]))${koreanAdversative}`, "u");
const namedPredicateMarker = new RegExp(`(?::|[가-힣]${koreanCaseParticle})$`, "u");
const classificationConjunction = / +(and|but|or)(?: +|$)/u;
const clauseVerb = new RegExp(String.raw`\b(?:${finitePredicate}|${infinitivalPassive})`, "u");
const scopedSubject = /^(?:if|whether|not all|no|not any)\b/u;

function isSubjectConjunct(predicates: string[], index: number): boolean {
  const previous = predicates[index - 2]?.trim();
  return Boolean(previous && predicates[index - 1] !== "but" && !clauseVerb.test(previous)
    && !previous.includes(":"));
}

function passiveSubjectHead(predicate: string, auxiliary: RegExpExecArray | null): string {
  // Before an auxiliary, an -ly ending alone cannot distinguish a noun from a modifier.
  if (auxiliary) {
    const head = predicate.slice(0, auxiliary.index).trim();
    return modifiersBeforeAuxiliary.test(head) ? "" : head;
  }
  const head = predicate.replace(participleTail, "").trim();
  return trailingPassiveModifiers.exec(head)?.index === 0 ? "" : head;
}

function passiveSubject(predicates: string[], index: number, subject: string): string {
  // A conjunct with its own auxiliary can still inherit the preceding subject.
  while (!subject && index >= 2) {
    index -= 2;
    const predicate = predicates[index]!.trim();
    const auxiliary = sharedPassive.exec(predicate);
    subject = passiveSubjectHead(predicate, auxiliary);
  }
  // Before that predicate, coordinated nouns can extend the same subject.
  while (!scopedSubject.test(subject) && isSubjectConjunct(predicates, index)) {
    subject = `${predicates[index - 2]!.trim()} ${predicates[index - 1]} ${subject}`;
    index -= 2;
  }
  return subject;
}

function readPassiveClassification(predicates: string[]): { answer: ReportedOrigin; completed?: boolean } {
  if (/^(?:if|whether)\b/u.test(predicates[0]!)) return { answer: "unconfirmed" };

  const local = predicates.length - 1;
  let modifiers = "";
  // Look for the closest auxiliary. Cross a conjunction only through a bare
  // participial predicate that can share it with "classified".
  for (let index = local; index >= 0; index -= 2) {
    const predicate = predicates[index]!.trim();
    const auxiliary = (index === local ? localPassive : sharedPassive).exec(predicate);
    const head = index === local ? predicate : predicate.replace(participleTail, "");
    const trailing = auxiliary ?? trailingPassiveModifiers.exec(head);
    if (trailing) modifiers = `${trailing[0]} ${modifiers}`.trimEnd();
    const ownSubject = auxiliary ? passiveSubjectHead(predicate, auxiliary) : "";
    const alternative = predicates[index - 1] === "or" && !(ownSubject && isSubjectConjunct(predicates, index));
    if (auxiliary?.groups?.["modal"] || uncertainCompletion.test(modifiers) || alternative) {
      return { answer: "unconfirmed" };
    }
    if (auxiliary) {
      const subject = passiveSubject(predicates, index, ownSubject);
      if (/^(?:if|whether|not all)\b/u.test(subject)) return { answer: "unconfirmed" };
      if (/^(?:no|not any)\b/u.test(subject) || /\bnot\b/u.test(modifiers)) return { answer: "denied" };
      return { answer: "affirmed", completed: Boolean(auxiliary.groups?.["finite"]) };
    }
    if (head && trailing?.index !== 0) break;
  }
  return { answer: /\bnot\b/u.test(modifiers) ? "denied" : "affirmed" };
}

function isOriginLabel(text: string): boolean {
  return originSubject.exec(text)?.[0] === text;
}

function readOriginAnswer(text: string): ReportedOrigin | undefined {
  const prefix = originPredicatePrefix.exec(text)?.[0] ?? "";
  if (/\b(?:not|never)\b/u.test(prefix)) return "unconfirmed";
  const predicate = text.slice(prefix.length);
  for (const answer of ["affirmed", "denied", "unconfirmed"] as const) {
    if (originAnswer[answer].test(predicate)) return answer;
  }
}

function readOriginClause(clause: string, coordinated = false): OriginClause {
  const question = clause.endsWith("?");
  const body = clause.replace(/\?$/u, "").trim();
  const text = body.replace(statusLabel, "");
  const named = originSubject.exec(text);
  if (named) {
    const predicate = text.slice(named[0].length);
    const answer = readOriginAnswer(predicate);
    // A category noun can also start an unrelated phrase such as "classification audit".
    if (coordinated && !answer && !question && predicate && !namedPredicateMarker.test(named[0].trimEnd())
      && predicate === predicate.replace(originPredicatePrefix, "")
      && !implicitOriginCue.test(predicate)) return { subject: "other" };
    return { subject: "category", answer: question ? "unconfirmed" : answer ?? "unconfirmed" };
  }

  // English allows an answer before the subject. Validate the entire subject in that order.
  for (const space of text.matchAll(/ /gu)) {
    const answer = readOriginAnswer(text.slice(0, space.index));
    if (answer && isOriginLabel(text.slice(space.index + 1))) {
      return { subject: "category", answer: question ? "unconfirmed" : answer };
    }
    // Answers are short. Do not repeatedly scan arbitrary source prose.
    if (space.index >= 32) break;
  }

  const independent = independentSubject.exec(text);
  if (independent) {
    const before = text.slice(0, independent.index).trim();
    const after = text.slice(independent.index + independent[0].length).trim().replace(/^: */u, "");
    const mentionsCategory = /\b(?:classification|applicability|designation|origin status)\b|폐기물 ?분류/u.test(after);
    const answerAfter = readOriginAnswer(after);
    if (!before && !mentionsCategory) {
      return { subject: "independent" };
    }
    if (!mentionsCategory && !coordinatedFacts.test(after)
      && (readOriginAnswer(before) || before === "awaiting")) return { subject: "independent" };
    if (answerAfter && !implicitOriginCue.test(before)) return { subject: "independent" };
  }

  const answer = readOriginAnswer(text.replace(/^: */u, ""));
  if (answer || question || text !== body || implicitOriginCue.test(text.replace(originPredicatePrefix, ""))) {
    return { subject: "implicit", answer: question ? "unconfirmed" : answer ?? "unconfirmed" };
  }
  return { subject: "other" };
}

function readOriginClauses(clause: string): OriginClause[] {
  return readOriginParts(clause.split(coordinatedFacts));
}

function readOriginParts(parts: string[], coordinated = parts.length > 1): OriginClause[] {
  // Bare predicates continue the preceding subject within the coordinated clause.
  let subject: Exclude<OriginClause["subject"], "implicit"> | undefined;
  const facts = parts.flatMap<OriginClause>(part => {
    const fact = readOriginClause(part, coordinated);
    if (fact.subject !== "implicit") {
      subject = fact.subject;
      return [fact];
    }
    if (subject === "category") return [{ ...fact, subject }];
    return subject === undefined ? [fact] : [];
  });
  return facts.every(fact => fact.subject === "other") ? [{ subject: "other" }] : facts;
}

function reportedMaterialOrigin(process: string | null): ReportedOrigin {
  const text = (process ?? "").normalize("NFKC").toLowerCase()
    .replace(/[\p{Zs}\t]+/gu, " ").replace(/ *:(?: *[\r\n\v\f\u0085\u2028\u2029])+ */gu, ": ")
    .replace(/。/gu, ".");
  const category = /(?<![\p{L}\p{N}_])(?:사업장 ?일반 ?폐기물|industrial general waste(?![\p{L}\p{N}_]))/gu;
  const declaration = category.exec(text);
  if (!declaration || category.exec(text)) return "unconfirmed";

  const clauses = [...text.matchAll(/[^,;.()[\]\r\n\v\f\u0085\u2028\u2029]+/gu)].filter(clause => clause[0].trim());
  const index = clauses.findIndex(clause =>
    declaration.index >= clause.index && declaration.index < clause.index + clause[0].length);
  const clause = clauses[index];
  if (!clause) return "unconfirmed";
  const offset = declaration.index - clause.index;
  const prefix = clause[0].slice(0, offset).trim();
  const tail = clause[0].slice(offset + declaration[0].length);
  let suffix = tail.trim();
  const korean = declaration[0].startsWith("사업장");
  const particle = korean ? koreanCategoryParticle.exec(suffix)?.[0] : undefined;
  if (particle) suffix = suffix.slice(particle.length).trim();
  if (/^[\p{L}\p{N}_]/u.test(tail) && !particle &&
    !(korean && (/^(?:여부|해당|인지|인 경우|이라고|입니다|이다)(?=$|[ :?])/u.test(suffix)
      || leadingKoreanAdversative.test(suffix)))) return "unconfirmed";
  suffix = suffix.replace(/^(?:입니다|이다)(?=$|[ ?])/u, "해당");

  const answers: ReportedOrigin[] = [];
  let processForLegacyDenial = text;
  const classified = /(?:^| )classified as$/u.exec(prefix);
  if (classified) {
    const predicates = prefix.slice(0, classified.index).split(classificationConjunction);
    const { answer, completed } = readPassiveClassification(predicates);
    if (answer === "unconfirmed") return answer;
    if (answer === "denied") answers.push(answer);
    const earlier = predicates.slice(0, -1).filter((_, index) => index % 2 === 0);
    for (const qualifier of readOriginParts(earlier, true)) {
      if (qualifier.subject === "category") answers.push(qualifier.answer);
    }
    // The passive reader binds subject and auxiliary polarity. Earlier named
    // category answers are checked below, independently of source prose.
    if (completed) processForLegacyDenial = text.slice(declaration.index);
  } else if (prefix === "not") {
    answers.push("denied");
  } else if (prefix && !(prefix.endsWith(":") && isOriginLabel(prefix)) &&
    !/^(?:산출 ?품목|폐기물 ?종류|분류) *:$/u.test(prefix) &&
    !(korean && prefix.endsWith("발생한") && readOriginAnswer(suffix) === "affirmed")) {
    return "unconfirmed";
  }

  const previous = clauses[index - 1];
  if (previous) {
    const preceding = previous[0].trim();
    const between = text.slice(previous.index + previous[0].length, clause.index);
    if (/\( *$/u.test(between) && !/[,;.\r\n]/u.test(between)) return "unconfirmed";
    if (/^(?:만약|if|possibly|probably|maybe)$|(?:또는|혹은|\bor)$/u.test(preceding)) return "unconfirmed";
  }

  for (const preceding of clauses.slice(0, index)) {
    for (const qualifier of readOriginClauses(preceding[0].trim())) {
      if (qualifier.subject === "category") answers.push(qualifier.answer);
    }
  }

  const direct = readOriginClauses(suffix);
  for (const qualifier of direct) {
    if (qualifier.subject === "category" || qualifier.subject === "implicit") answers.push(qualifier.answer);
  }
  // Only a nearby unlabeled answer refers back to the declaration. A named
  // category qualifier can still qualify it after a separate factual clause.
  let adjacent = !direct.some(qualifier => qualifier.subject === "independent" ||
    (direct.length > 1 && qualifier.subject === "other"));
  for (const following of clauses.slice(index + 1)) {
    for (const qualifier of readOriginClauses(following[0].trim())) {
      if (qualifier.subject === "category" || (adjacent && qualifier.subject === "implicit")) {
        answers.push(qualifier.answer);
      } else {
        adjacent = false;
      }
    }
  }
  if (answers.includes("unconfirmed") || (answers.includes("affirmed") && answers.includes("denied"))) return "unconfirmed";
  return answers.includes("denied") || legacyOriginNegation.test(processForLegacyDenial) ? "denied" : "affirmed";
}

function supportedMaterialStream(input: CaseInput, contamination: string | null): MaterialStream | null {
  if (isUnknownCaseText(input.polymer)) return null;
  const reported = [input.polymer, input.description, input.process, contamination]
    .map(value => (value ?? "").normalize("NFKC"));
  if (reportedMaterialOrigin(input.process) !== "affirmed") return null;
  if (reported.some(value =>
    /(?:무처리|미처리|무코팅|비코팅)[^,.;\n]{0,12}(?:아님|아닌)|\bnot\s+(?:untreated|uncoated)\b/iu.test(value)
    || [...value.matchAll(/(?:무처리|미처리|무코팅|비코팅|처리\s*이력|코팅\s*이력|treatment\s+history|coating\s+history)\s*(?:여부|이력|유무)?\s*(?:은|는|이|가)?\s*[:：]?\s*([^,.;\n]+)/giu)]
      .some(match => isUnknownCaseText(match[1], "clause")))) return null;
  if (excludedStream.test([input.process, input.description].map(maskMaterialDenials).join(" "))) return null;
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
  if (!explicitlyUntreatedWood(material) && (treatmentAssertions(contamination, "wood") !== null
    || !/무처리|미처리|\buntreated\b|원목\s*상태/iu.test([input.process, contamination].join(" ")))) return null;
  if (/원목\s*(?:제재|가공)|제재소|sawmill|lumber mill/iu.test(input.process ?? "")) return "wood-byproduct";
  if (["wood-packaging", "untreated-wood-packaging"].includes(material)
    && /포장|팔레트/iu.test(input.process ?? "")) return "wood-packaging";
  return null;
}

function materialTerms(masked: string): string[] {
  return [...masked.replace(/\b(?:unpainted|untreated|oil-free)\b/giu, "")
    .matchAll(new RegExp(materialHazard.source, "giu"))].map(match => match[0]);
}

/** Keep affirmative risk in each field even when another field denies contact. */
function scanMaterialHazards(input: CaseInput): { terms: readonly string[]; hold: boolean } {
  const family = materialFamily(input);
  if (family === null) return { terms: [], hold: false };
  const assertions = treatmentAssertions(input.contamination, family);
  const fields = [input.polymer, input.description, input.process];
  if (assertions === null) fields.push(input.contamination);
  const unplated = fields.map(value => unplatedFields.has((value ?? "").normalize("NFKC").trim()));
  const hazardFields = fields.map((value, index) => unplated[index] ? "" : maskMaterialDenials(value));
  if (assertions === null) {
    const terms = [...new Set(hazardFields.flatMap(materialTerms))];
    // Coating can keep a treatment hold alongside an exact unplated field without a display term.
    const hold = terms.length > 0 || (unplated.includes(true) && hazardFields.some(value => coatingSignal.test(value)));
    return { terms, hold };
  }

  // Keep the whole-field veto and recover assertions that the old mask joins across lines.
  const factualTexts = hazardFields.flatMap((whole, index) => unplated[index] ? [] :
    [whole, ...(fields[index] ?? "").split(physicalLineBoundary).map(maskMaterialDenials)]);
  const factualTerms = factualTexts.flatMap(materialTerms);
  const factualHold = factualTerms.length > 0 || factualTexts.some(value => coatingSignal.test(value));
  const mixed = !onlyCleanAssertions(assertions);
  const material = canonicalMaterial(input.polymer);
  const plainWood = material === "wood" || material === "wood-packaging";
  const scanned = assertions.map(assertion => {
    const masked = maskMaterialDenials(assertion);
    const fullyMasked = masked !== assertion.normalize("NFKC") && /^[,;.\s]*$/u.test(masked);
    return { denial: treatmentDenials.has(assertion), clean: standaloneClean.test(assertion) || fullyMasked,
      terms: materialTerms(masked), coating: coatingSignal.test(masked) };
  });
  // An opaque assertion may qualify a denial. A separately reported hazard has its own display terms.
  const opaque = scanned.some(({ denial, clean, terms, coating }) => !denial && !clean && terms.length === 0 && !coating);
  const retainDenialTerms = opaque || (plainWood && !mixed && !factualHold);
  const contaminationTerms = scanned.flatMap(({ denial, terms }) => denial && !retainDenialTerms ? [] : terms);
  return {
    terms: [...new Set([...factualTerms, ...contaminationTerms])],
    hold: mixed || plainWood || factualHold,
  };
}

export function materialHazardTerms(input: CaseInput): readonly string[] {
  return scanMaterialHazards(input).terms;
}

export function materialHazardReasons(input: CaseInput): readonly string[] {
  return scanMaterialHazards(input).hold ? [safetyReasons.materialTreatment] : [];
}

function hasUnresolvedMaterialHistory(value: string | null): boolean {
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
}

function hasCorroboratedCopperResidueAbsence(input: CaseInput): boolean {
  const fields = [input.polymer, input.description, input.process, input.contamination];
  if (fields.some(value => value !== null && (physicalLineBoundary.test(value) || value.includes("\uFEFF")))) return false;
  const normalize = (value: string | null) => (value ?? "").normalize("NFKC")
    .replace(/[\p{Zs}\t]+/gu, " ").replace(/^ | $/gu, "");
  if (canonicalMaterial(input.polymer) !== "copper" || !standaloneClean.test(normalize(input.contamination))) return false;

  const descriptor = /^([^,]+?) *, *잔여물은 없음 *\.?$/u.exec(normalize(input.description))?.[1];
  if (descriptor === undefined || canonicalMaterial(descriptor.replace(/ (?:절단편|스크랩)$/u, "")) !== "copper") return false;

  // The complete process must corroborate the observation. A matching prefix can be followed by another assertion.
  const origin = /^사업장일반폐기물(?: *, *| )(.+)$/u.exec(normalize(input.process))?.[1];
  if (origin === undefined) return false;
  if (origin === "금속 절단") return true;
  const copperSource = /^(?:([^,]+) 절단 공정|기계 가공 공정에서 나온 ([^,]+) 절삭 스크랩)$/u.exec(origin);
  return canonicalMaterial(copperSource?.[1] ?? copperSource?.[2]) === "copper";
}

export function materialQuestions(input: CaseInput): readonly string[] {
  const family = materialFamily(input);
  if (family === null) return [];
  const questions: string[] = [];
  const material = input.polymer?.trim() ?? "";
  if (reportedMaterialOrigin(input.process) === "unconfirmed") {
    questions.push("발생 공정 입력란에 사업장일반폐기물 해당 여부와 실제 발생원을 알려 주세요. 생활·건설·지정폐기물 여부에 따라 분류가 달라집니다.");
  }
  if (family === "metal" && !["ferrous", "nonferrous", "aluminum", "copper"].includes(canonicalMaterial(material) ?? "")) {
    questions.push("철·비철 구분과 정확한 금속 품목을 알려 주세요. 금속캔·용기, 분진·슬러지 또는 혼합물은 별도 분류 근거가 필요합니다.");
  }
  if (family === "metal" && excludedStream.test([input.process, input.description].map(maskMaterialDenials).join(" "))) {
    questions.push("별도 분류 대상 발생물의 구체적 발생원·성분·유해성을 확인해 주세요. 일반 금속 스크랩 코드로 추정하지 않습니다.");
  }
  if (family === "wood" && materialStream(input) === null) {
    questions.push("원목 제재·가공 부산물인지 사용한 포장재·가구·건설 목재인지 알려 주세요. 도장·접착·방부·오일 처리 이력도 확인해 주세요.");
  }
  if (family === "wood" && (treatmentAssertions(input.contamination, family) !== null
    ? !explicitlyUntreatedWood(canonicalMaterial(material))
    : !/무처리|미처리|\buntreated\b|원목\s*상태/iu.test([material, input.process, input.contamination].join(" ")))) {
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
  const unresolvedHistory = hasUnresolvedMaterialHistory(input.process)
    || (hasUnresolvedMaterialHistory(input.description) && !hasCorroboratedCopperResidueAbsence(input));
  if ((unresolvedHistory || (input.contamination?.trim() && !isDeclaredCleanMaterial(input, family)))
    && materialHazardReasons(input).length === 0) questions.push(safetyReasons.contaminationUnknown);
  return questions;
}
