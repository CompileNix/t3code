export type ClockMode = "hour" | "minute";

export interface ClockTime {
  readonly hour: number;
  readonly minute: number;
}

/** Fraction of the dial radius below which a 24-hour dial reads the inner ring. */
const INNER_RING_THRESHOLD = 0.72;

export function parseClockTime(value: string): ClockTime | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function clockTimeValue(time: ClockTime): string {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

/** Degrees clockwise from 12 o'clock for a point relative to the dial center (y grows down). */
function clockAngle(x: number, y: number): number {
  const degrees = (Math.atan2(x, -y) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

/**
 * Reads a pointer on the dial, given relative to its center as a fraction of its radius.
 * 12-hour dials keep the current half of the day; 24-hour dials put 0-11 on the outer
 * ring and 12-23 on the inner one, as Android does.
 */
export function pickOnDial(
  point: { readonly x: number; readonly y: number },
  mode: ClockMode,
  hour12: boolean,
  time: ClockTime,
): ClockTime {
  const angle = clockAngle(point.x, point.y);
  if (mode === "minute") return { ...time, minute: Math.round(angle / 6) % 60 };
  const position = Math.round(angle / 30) % 12;
  if (hour12) return { ...time, hour: position + (time.hour >= 12 ? 12 : 0) };
  const inner = Math.hypot(point.x, point.y) < INNER_RING_THRESHOLD;
  return { ...time, hour: position + (inner ? 12 : 0) };
}

/** Steps the hour or minute, wrapping within the day like a clock. */
export function stepClock(time: ClockTime, mode: ClockMode, delta: number): ClockTime {
  if (mode === "minute") return { ...time, minute: (((time.minute + delta) % 60) + 60) % 60 };
  return { ...time, hour: (((time.hour + delta) % 24) + 24) % 24 };
}

/** Position of a dial value: 12 o'clock slot index (0-11 for hours, 0-59 for minutes). */
export function dialSlot(time: ClockTime, mode: ClockMode): { slot: number; inner: boolean } {
  if (mode === "minute") return { slot: time.minute, inner: false };
  return { slot: time.hour % 12, inner: time.hour >= 12 };
}
