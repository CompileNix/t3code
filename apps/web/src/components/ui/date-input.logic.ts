/** Reads a `YYYY-MM-DD` value, like a native date input's, as local midnight. */
export function parseDateValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  // Rejects overflow such as 2026-02-31, which Date rolls into March.
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day)
    return null;
  return date;
}

export function dateValue(date: Date): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Years the month/year dropdowns offer: from the earlier of the value and today, ten years on. */
export function dropdownRange(
  selected: Date | null,
  today: Date,
  yearsAhead = 10,
): { startMonth: Date; endMonth: Date } {
  const first = selected !== null && selected < today ? selected : today;
  const last = selected !== null && selected > today ? selected : today;
  return {
    startMonth: new Date(first.getFullYear(), 0, 1),
    endMonth: new Date(Math.max(last.getFullYear(), today.getFullYear() + yearsAhead), 11, 1),
  };
}
