export type ReviewStep = "materials" | "evidence" | "routes";
export type ReviewProgress = (step: ReviewStep) => void;

const tokenPattern = /^[a-f0-9]{32}$/;
export function reviewProgressStore() {
  const active = new Map<string, { owner: string; step: ReviewStep }>();
  return {
    start(owner: string, token: string | null) {
      if (!token || !tokenPattern.test(token) || active.has(token) || active.size >= 256) return undefined;
      const entry = { owner, step: "materials" as ReviewStep };
      active.set(token, entry);
      return {
        report: (step: ReviewStep) => { entry.step = step; },
        done: () => { if (active.get(token) === entry) active.delete(token); },
      };
    },
    read(owner: string, token: string) {
      const entry = active.get(token);
      return entry?.owner === owner ? entry.step : undefined;
    },
  };
}
