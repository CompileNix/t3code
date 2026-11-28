import { describe, expect, it } from "vite-plus/test";

import { pickOnDial, stepClock } from "./time-input.logic";

const at = (degrees: number, radius = 0.9) => {
  const radians = (degrees * Math.PI) / 180;
  return { x: Math.sin(radians) * radius, y: -Math.cos(radians) * radius };
};

describe("pickOnDial", () => {
  it.each([
    ["12-hour top keeps the morning", at(0), true, { hour: 9, minute: 5 }, 0],
    ["12-hour top keeps the evening", at(0), true, { hour: 21, minute: 5 }, 12],
    ["12-hour 3 o'clock in the evening", at(90), true, { hour: 21, minute: 5 }, 15],
    ["24-hour outer ring", at(90), false, { hour: 21, minute: 5 }, 3],
    ["24-hour inner ring", at(90, 0.5), false, { hour: 3, minute: 5 }, 15],
    ["24-hour inner top", at(0, 0.5), false, { hour: 3, minute: 5 }, 12],
    ["snaps to the nearest hour", at(100), true, { hour: 1, minute: 0 }, 3],
    ["wraps just before 12", at(350), true, { hour: 1, minute: 0 }, 0],
  ])("%s", (_name, point, hour12, time, hour) => {
    expect(pickOnDial(point, "hour", hour12, time)).toEqual({ ...time, hour });
  });

  it("reads single minutes and wraps at the top", () => {
    const time = { hour: 9, minute: 0 };
    expect(pickOnDial(at(90), "minute", true, time).minute).toBe(15);
    expect(pickOnDial(at(93), "minute", false, time).minute).toBe(16);
    expect(pickOnDial(at(358), "minute", false, time).minute).toBe(0);
  });
});

describe("stepClock", () => {
  it("wraps hours across midnight and minutes within the hour", () => {
    expect(stepClock({ hour: 23, minute: 59 }, "hour", 1)).toEqual({ hour: 0, minute: 59 });
    expect(stepClock({ hour: 0, minute: 0 }, "hour", -1)).toEqual({ hour: 23, minute: 0 });
    expect(stepClock({ hour: 9, minute: 59 }, "minute", 1)).toEqual({ hour: 9, minute: 0 });
    expect(stepClock({ hour: 9, minute: 0 }, "minute", -1)).toEqual({ hour: 9, minute: 59 });
  });
});
