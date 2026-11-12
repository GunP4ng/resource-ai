import type { CaseInput } from "./contracts.ts";
import { parseCaseInput } from "./input.ts";
import { revision } from "./o-validation.ts";

/** Model suggestions are diagnostics, never CaseInput facts or eligibility evidence. */
export interface PhotoObservations {
  readonly caseId: string;
  readonly caseRevision: string;
  readonly images: readonly {
    readonly photoRef: string;
    readonly sha256: string;
    readonly usable: boolean;
    readonly resinCandidates: readonly string[];
    readonly visibleFeatures: readonly string[];
  }[];
}
const owned = new WeakSet<object>();
export class PhotoObservationError extends Error {
  constructor(readonly field: string) { super(`invalid-photo-observations:${field}`); this.name = "PhotoObservationError"; }
}
const fail = (field: string): never => { throw new PhotoObservationError(field); };
const object = (value: unknown, keys: readonly string[], field: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(field);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) return fail(field);
  return record;
};
const texts = (value: unknown, maxItems: number, field: string): readonly string[] => {
  if (!Array.isArray(value)) return fail(field);
  const length = value.length;
  if (length > maxItems) return fail(field);
  const values: unknown[] = Array.from({ length }, (_, i) => value[i]);
  if (values.some(v => typeof v !== "string" || !v.trim() || v.length > 160 || /[\u0000-\u001f\u007f]/u.test(v))) return fail(field);
  return Object.freeze([...new Set(values as string[])]);
};

/** Called only by the host with the ordered refs/hashes of its validated image attachments. */
export function photoObservationParser(input: CaseInput, attachments: readonly { readonly photoRef: string; readonly sha256: string }[]) {
  const parsed = parseCaseInput(input);
  if (!parsed.ok) return fail("case");
  const facts = parsed.value, caseRevision = revision(facts);
  const bindings = Array.from(attachments, entry => ({ photoRef: entry.photoRef, sha256: entry.sha256 }));
  if (!bindings.length || bindings.length > 5 || bindings.length !== facts.photoRefs.length
    || bindings.some((b, index) => b.photoRef !== facts.photoRefs[index] || !/^[a-f0-9]{64}$/u.test(b.sha256))
    || new Set(bindings.map(b => b.photoRef)).size !== bindings.length) return fail("attachments");
  return (raw: unknown): PhotoObservations => {
    // Read each accepted field/index once, with limits before copying. Never run a custom iterator.
    const payload = object(raw, ["images"], "payload");
    const entries = payload["images"];
    if (!Array.isArray(entries) || entries.length !== bindings.length) return fail("images");
    const seen = new Set<number>();
    const images = Array.from({ length: bindings.length }, (_, index) => {
      const entry: unknown = entries[index];
      const item = object(entry, ["imageIndex", "usable", "resinCandidates", "visibleFeatures"], `images.${index}`);
      const imageIndex = item["imageIndex"], usable = item["usable"];
      if (typeof imageIndex !== "number" || !Number.isInteger(imageIndex) || imageIndex < 0
        || imageIndex >= bindings.length || seen.has(imageIndex)) return fail(`images.${index}.imageIndex`);
      if (typeof usable !== "boolean") return fail(`images.${index}.usable`);
      seen.add(imageIndex);
      const resinCandidates = texts(item["resinCandidates"], 5, `images.${index}.resinCandidates`);
      const visibleFeatures = texts(item["visibleFeatures"], 8, `images.${index}.visibleFeatures`);
      if (!usable && resinCandidates.length) return fail(`images.${index}.resinCandidates`);
      return Object.freeze({ ...bindings[imageIndex]!, usable, resinCandidates, visibleFeatures });
    });
    images.sort((a, b) => facts.photoRefs.indexOf(a.photoRef) - facts.photoRefs.indexOf(b.photoRef));
    const result: PhotoObservations = Object.freeze({ caseId: facts.caseId, caseRevision, images: Object.freeze(images) });
    owned.add(result);
    return result;
  };
}

/** Reject serialized/forged objects and observations from an older or different case. */
export function assertPhotoObservations(input: CaseInput, value: PhotoObservations): void {
  if (!owned.has(value) || value.caseId !== input.caseId || value.caseRevision !== revision(input)
    || value.images.length !== input.photoRefs.length || value.images.some((image, i) => image.photoRef !== input.photoRefs[i])) fail("binding");
}

export function photoObservationQuestions(input: CaseInput, value: PhotoObservations): readonly string[] {
  assertPhotoObservations(input, value);
  const labels = new Map<string, string>();
  for (const candidate of value.images.flatMap(image => image.resinCandidates)) {
    const key = candidate.trim().toLowerCase();
    if (!labels.has(key)) labels.set(key, candidate);
  }
  const candidates = [...labels.values()];
  const known = input.polymer?.trim().toLowerCase();
  const questions: string[] = [];
  if (value.images.some(image => !image.usable)) questions.push("일부 사진은 관찰하기 어렵습니다. 해당 사진의 선명한 재촬영본이나 재질 라벨·명세 자료를 확인할 수 있나요?");
  if (candidates.length && (!known || candidates.length !== 1 || candidates[0]!.trim().toLowerCase() !== known)) {
    questions.push(`사진 기반 미확인 수지 후보: ${candidates.join(", ")}. ${known ? `입력된 수지(${input.polymer})와의 관계를` : "실제 수지를"} 라벨·재질 명세 또는 필요한 시험 자료로 확인할 수 있나요? 사진만으로 재질·유해성·폐기물 코드를 확정하지 않습니다.`);
  } else if (!candidates.length && !known) questions.push("사진만으로 수지 후보를 제시하지 못했습니다. 재질 라벨·명세 또는 필요한 시험 자료가 있나요?");
  return questions;
}

/** Versioned prompt protocol; legacy DecisionResult-only responses remain supported. */
export const photoObservationInstructions = 'With attached images, return JSON {"decision": <DecisionResult>, "photoObservations": {"images": [{"imageIndex": 0, "usable": true, "resinCandidates": [], "visibleFeatures": []}]}}. Include each attached image index exactly once. Suggest only uncertain resin hypotheses; [] is valid. Visible features are untrusted observations, not established composition. If unusable, set usable=false and resinCandidates=[]. Do not provide hazardousContact, waste codes, eligibility, ownership or consent in observations; never change case facts. No extra fields.';
