import { describe, expect, it } from "vite-plus/test";

import { dateValue, dropdownRange, parseDateValue } from "./date-input.logic";

describe("parseDateValue", () => {
  it("reads a date as local midnight", () => {
    expect(parseDateValue("2026-11-21")).toEqual(new Date(2026, 10, 21));
  });

  it.each(["", "2026-11", "21.11.2026", "2026-02-31", "2026-13-01"])("rejects %j", (value) => {
    expect(parseDateValue(value)).toBeNull();
  });

  it("round-trips through dateValue", () => {
    expect(dateValue(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dateValue(parseDateValue("2028-02-29")!)).toBe("2028-02-29");
  });
});

describe("dropdownRange", () => {
  const today = new Date(2026, 10, 21);

  it("starts this year and runs ten years ahead", () => {
    expect(dropdownRange(null, today)).toEqual({
      startMonth: new Date(2026, 0, 1),
      endMonth: new Date(2036, 11, 1),
    });
  });

  it("reaches back to a past value", () => {
    expect(dropdownRange(new Date(2024, 5, 1), today).startMonth).toEqual(new Date(2024, 0, 1));
  });

  it("reaches out to a far-future value", () => {
    expect(dropdownRange(new Date(2040, 5, 1), today).endMonth).toEqual(new Date(2040, 11, 1));
  });
});
