import { describe, expect, it, vi } from "vite-plus/test";

import {
  formatChatTimestampTooltip,
  formatDateTimeTimestamp,
  formatDayAwareTimestamp,
  formatTimeOfDay,
  formatUpcomingTimestamp,
  parseTimeOfDay,
} from "./timestampFormat";

// Node re-resolves the default zone when TZ is assigned, like a renderer after the OS zone changes.
function useTimeZone(timeZone: string): Disposable {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  return {
    [Symbol.dispose]: () => {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    },
  };
}

it("writes full timestamps in the system locale", async () => {
  using _zone = useTimeZone("UTC");
  vi.stubGlobal("window", { desktopBridge: { getSystemLocale: () => "de-DE" } });
  vi.resetModules();
  try {
    const { formatFullTimestamp } = await import("./timestampFormat");
    expect(formatFullTimestamp("2026-11-19T18:05:00.000Z", "24-hour")).toBe("19.11.2026, 18:05:00");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("localizes the day period while honoring the system clock and explicit 24-hour mode", async () => {
  using _zone = useTimeZone("UTC");
  vi.stubGlobal("window", { desktopBridge: { getSystemLocale: () => "en-US" } });
  vi.resetModules();
  try {
    const { formatShortTimestamp } = await import("./timestampFormat");
    const date = "2026-11-19T18:05:00.000Z";
    expect(formatShortTimestamp(date, "locale", "zh")).toBe("下午6:05");
    expect(formatShortTimestamp(date, "24-hour", "zh")).toBe("18:05");
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("timestamps in an explicit time zone", () => {
  // 23:00 UTC on July 1 is 7 PM on July 1 in New York, whatever the host zone.
  const now = Date.parse("2026-07-01T23:00:00.000Z");
  const zone = "America/New_York";

  it("picks relative days from the calendar in that zone", () => {
    expect(formatUpcomingTimestamp("2026-07-02T00:30:00.000Z", "12-hour", now, zone)).not.toMatch(
      /tomorrow/,
    );
    expect(formatUpcomingTimestamp("2026-07-02T05:30:00.000Z", "12-hour", now, zone)).toMatch(
      /^tomorrow at /,
    );
    expect(formatDayAwareTimestamp("2026-07-01T03:30:00.000Z", "12-hour", now, zone)).toMatch(
      /^yesterday at /,
    );
  });
});

describe("timestamps after the system time zone changes", () => {
  // Built fresh with an explicit zone, so expectations follow the host locale but not a stale zone.
  const timeIn = (iso: string, timeZone: string) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    }).format(new Date(iso));
  const dayIn = (iso: string, timeZone: string) =>
    new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", timeZone }).format(
      new Date(iso),
    );

  it("renders the gutter label in the new zone", () => {
    const sameDay = "2026-11-07T04:45:43.877Z";
    const earlierInWeek = "2026-11-04T20:00:00.000Z";
    const now = Date.parse(sameDay);
    using _zone = useTimeZone("America/New_York");
    expect([
      formatDayAwareTimestamp(sameDay, "12-hour", now),
      formatDayAwareTimestamp(earlierInWeek, "12-hour", now),
    ]).toEqual([
      timeIn(sameDay, "America/New_York"),
      `${dayIn(earlierInWeek, "America/New_York")} ${timeIn(earlierInWeek, "America/New_York")}`,
    ]);

    process.env.TZ = "Asia/Bangkok";
    expect([
      formatDayAwareTimestamp(sameDay, "12-hour", now),
      formatDayAwareTimestamp(earlierInWeek, "12-hour", now),
    ]).toEqual([
      timeIn(sameDay, "Asia/Bangkok"),
      `${dayIn(earlierInWeek, "Asia/Bangkok")} ${timeIn(earlierInWeek, "Asia/Bangkok")}`,
    ]);
  });

  it("renders date and time labels in the new zone", () => {
    const iso = "2026-11-07T04:45:00.000Z";
    const dateTimeIn = (timeZone: string) =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        hour12: true,
        timeZone,
      }).format(new Date(iso));
    using _zone = useTimeZone("America/New_York");
    expect(formatDateTimeTimestamp(iso, "12-hour")).toBe(dateTimeIn("America/New_York"));

    process.env.TZ = "Asia/Bangkok";
    expect(formatDateTimeTimestamp(iso, "12-hour")).toBe(dateTimeIn("Asia/Bangkok"));
  });

  it("renders the tooltip in the new zone", () => {
    const monthEnd = "2026-10-31T20:00:00.000Z";
    using _zone = useTimeZone("America/New_York");
    expect(formatChatTimestampTooltip(monthEnd, "12-hour")).toBe(
      `${timeIn(monthEnd, "America/New_York")}, 31st October 2026`,
    );

    process.env.TZ = "Asia/Bangkok";
    expect(formatChatTimestampTooltip(monthEnd, "12-hour")).toBe(
      `${timeIn(monthEnd, "Asia/Bangkok")}, 1st November 2026`,
    );
  });
});

describe("time of day input", () => {
  it.each([
    ["21:30", "21:30"],
    ["9:30 pm", "21:30"],
    ["9:30 P.M.", "21:30"],
    ["9p", "21:00"],
    ["12 am", "00:00"],
    ["12:15 PM", "12:15"],
    ["930", "09:30"],
    ["0", "00:00"],
    ["7.05", "07:05"],
    ["21 h 30", "21:30"],
    ["24:00", null],
    ["13 pm", null],
    ["9:60", null],
    ["12345", null],
    ["noon", null],
    ["", null],
  ])("reads %j as %j", (text, expected) => {
    expect(parseTimeOfDay(text)).toBe(expected);
  });

  it("formats in the chosen clock and reads its own output back", () => {
    expect(formatTimeOfDay("21:05", "24-hour")).toMatch(/^21.05$/);
    expect(formatTimeOfDay("21:05", "12-hour")).toMatch(/9.05/);
    for (const format of ["12-hour", "24-hour", "locale"] as const) {
      for (const value of ["00:00", "09:30", "12:00", "21:05"]) {
        expect(parseTimeOfDay(formatTimeOfDay(value, format))).toBe(value);
      }
    }
  });
});
