const seoulTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function koreanDateTime(value: number | string, withYear: boolean): string {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return "확인 필요";
  const parts = seoulTime.formatToParts(timestamp);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
  return `${withYear ? `${get("year")}년 ` : ""}${get("month")}월 ${get("day")}일 ${get("hour")}:${get("minute")}`;
}

export function koreanDeadline(value: number): string {
  return `<time datetime="${new Date(value).toISOString()}">${koreanDateTime(value, false)}까지</time>`;
}

export function koreanSourceDate(value: string): string {
  return value.replace(/\b(?:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))|(\d{4})-(\d{2})(?:-(\d{2}))?)(?![-:\d])\b/gu,
    (_, timestamp, year, month, day) => timestamp ? koreanDateTime(timestamp, true)
      : `${year}년 ${Number(month)}월${day ? ` ${Number(day)}일` : ""}`);
}
