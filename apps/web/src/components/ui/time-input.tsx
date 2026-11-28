import type { TimestampFormat } from "@t3tools/contracts/settings";
import { T, useGT } from "gt-react";
import { ClockIcon } from "lucide-react";
import { type ChangeEvent, type KeyboardEvent, type PointerEvent, useState } from "react";

import { cn } from "~/lib/utils";
import { dayPeriodLabels, formatTimeOfDay, parseTimeOfDay, resolveHour12 } from "~/timestampFormat";
import { Button } from "./button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group";
import type { InputProps } from "./input";
import { Popover, PopoverPopup, PopoverTrigger } from "./popover";
import {
  type ClockMode,
  type ClockTime,
  clockTimeValue,
  dialSlot,
  parseClockTime,
  pickOnDial,
  stepClock,
} from "./time-input.logic";

type TimeInputProps = Omit<
  InputProps,
  "value" | "defaultValue" | "onChange" | "onValueChange" | "type" | "nativeInput" | "className"
> & {
  className?: string;
  /** `HH:mm`, like a native time input, or empty when unset. */
  value: string;
  onValueChange: (value: string) => void;
  timestampFormat: TimestampFormat;
};

// A native time input follows the OS clock and ignores the app's Time format setting.
function TimeInput({
  value,
  onValueChange,
  timestampFormat,
  onBlur,
  className,
  disabled,
  ...props
}: TimeInputProps) {
  const gt = useGT();
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const invalid = draft !== null && parseTimeOfDay(draft) === null;
  return (
    <InputGroup className={className}>
      <InputGroupInput
        {...props}
        disabled={disabled}
        nativeInput
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder={props.placeholder ?? formatTimeOfDay("09:00", timestampFormat)}
        aria-invalid={invalid || props["aria-invalid"] || undefined}
        value={draft ?? (value ? formatTimeOfDay(value, timestampFormat) : "")}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const text = event.target.value;
          setDraft(text);
          const parsed = parseTimeOfDay(text);
          if (parsed !== null && parsed !== value) onValueChange(parsed);
        }}
        onBlur={(event) => {
          setDraft(null);
          onBlur?.(event);
        }}
      />
      <InputGroupAddon align="inline-end">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={disabled}
                aria-label={gt("Choose time", { $context: "time of day" })}
              />
            }
          >
            <ClockIcon />
          </PopoverTrigger>
          <PopoverPopup align="end" aria-label={gt("Choose time", { $context: "time of day" })}>
            <ClockPicker
              initial={parseClockTime(value) ?? currentClockTime()}
              hour12={resolveHour12(timestampFormat)}
              onCancel={() => setOpen(false)}
              onConfirm={(time) => {
                setOpen(false);
                setDraft(null);
                const next = clockTimeValue(time);
                if (next !== value) onValueChange(next);
              }}
            />
          </PopoverPopup>
        </Popover>
      </InputGroupAddon>
    </InputGroup>
  );
}

function currentClockTime(): ClockTime {
  const now = new Date();
  return { hour: now.getHours(), minute: now.getMinutes() };
}

const DIAL_OUTER_RADIUS = 80;
const DIAL_INNER_RADIUS = 52;
const pad = (value: number) => String(value).padStart(2, "0");

function dialPoint(slot: number, slots: number, radius: number) {
  const radians = (slot / slots) * 2 * Math.PI;
  return { x: Math.sin(radians) * radius, y: -Math.cos(radians) * radius };
}

function dialLabels(mode: ClockMode, hour12: boolean) {
  if (mode === "minute") {
    return Array.from({ length: 12 }, (_, index) => ({
      key: `m${index}`,
      label: pad(index * 5),
      selects: { slot: index * 5, inner: false },
      ...dialPoint(index, 12, DIAL_OUTER_RADIUS),
    }));
  }
  const ring = (inner: boolean) =>
    Array.from({ length: 12 }, (_, index) => {
      const hour = index + (inner ? 12 : 0);
      return {
        key: `h${hour}`,
        label: hour12 ? String(index === 0 ? 12 : index) : hour === 0 ? "00" : String(hour),
        selects: { slot: index, inner },
        ...dialPoint(index, 12, inner ? DIAL_INNER_RADIUS : DIAL_OUTER_RADIUS),
      };
    });
  return hour12 ? ring(false) : [...ring(false), ...ring(true)];
}

function ClockPicker(props: {
  initial: ClockTime;
  hour12: boolean;
  onCancel: () => void;
  onConfirm: (time: ClockTime) => void;
}) {
  const gt = useGT();
  const { hour12 } = props;
  const [time, setTime] = useState(props.initial);
  const [mode, setMode] = useState<ClockMode>("hour");
  const periods = dayPeriodLabels();
  const pm = time.hour >= 12;
  const selected = dialSlot(time, mode);
  // A 12-hour dial has no inner ring, so its hand always reaches the outer one.
  const handRadius = selected.inner && !hour12 ? DIAL_INNER_RADIUS : DIAL_OUTER_RADIUS;
  const hand = dialPoint(selected.slot, mode === "minute" ? 60 : 12, handRadius);
  const hourLabel = hour12 ? String(time.hour % 12 === 0 ? 12 : time.hour % 12) : pad(time.hour);

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const radius = rect.width / 2;
    const point = {
      x: (event.clientX - rect.left - radius) / radius,
      y: (event.clientY - rect.top - radius) / radius,
    };
    setTime((current) => pickOnDial(point, mode, hour12, current));
  };

  const onDialKey = (event: KeyboardEvent<SVGSVGElement>) => {
    const delta =
      event.key === "ArrowUp" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowDown" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (delta !== 0) {
      event.preventDefault();
      setTime((current) => stepClock(current, mode, delta));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (mode === "hour") setMode("minute");
      else props.onConfirm(time);
    }
  };

  const segmentClassName = (active: boolean) =>
    cn(
      "rounded-lg px-2 py-1 text-4xl font-medium tabular-nums leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
    );
  const periodClassName = (active: boolean) =>
    cn(
      "px-2 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
    );

  return (
    <div className="flex w-60 flex-col gap-4">
      <div className="flex items-center justify-center gap-1">
        <button
          type="button"
          className={segmentClassName(mode === "hour")}
          aria-pressed={mode === "hour"}
          aria-label={gt("Hour")}
          onClick={() => setMode("hour")}
        >
          {hourLabel}
        </button>
        <span className="text-4xl font-medium leading-none text-muted-foreground">:</span>
        <button
          type="button"
          className={segmentClassName(mode === "minute")}
          aria-pressed={mode === "minute"}
          aria-label={gt("Minute")}
          onClick={() => setMode("minute")}
        >
          {pad(time.minute)}
        </button>
        {hour12 ? (
          <div className="ms-2 flex flex-col overflow-hidden rounded-lg border border-input">
            <button
              type="button"
              className={periodClassName(!pm)}
              aria-pressed={!pm}
              onClick={() => setTime((current) => ({ ...current, hour: current.hour % 12 }))}
            >
              {periods.am}
            </button>
            <button
              type="button"
              className={cn(periodClassName(pm), "border-t border-input")}
              aria-pressed={pm}
              onClick={() => setTime((current) => ({ ...current, hour: (current.hour % 12) + 12 }))}
            >
              {periods.pm}
            </button>
          </div>
        ) : null}
      </div>
      <svg
        viewBox="-100 -100 200 200"
        className="mx-auto size-56 touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        role="slider"
        tabIndex={0}
        aria-label={mode === "hour" ? gt("Hour") : gt("Minute")}
        aria-valuemin={0}
        aria-valuemax={mode === "hour" ? 23 : 59}
        aria-valuenow={mode === "hour" ? time.hour : time.minute}
        aria-valuetext={mode === "hour" ? hourLabel : pad(time.minute)}
        onKeyDown={onDialKey}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pick(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event);
        }}
        onPointerUp={() => {
          if (mode === "hour") setMode("minute");
        }}
      >
        <circle r="100" className="fill-muted" />
        <line x1="0" y1="0" x2={hand.x} y2={hand.y} strokeWidth="2" className="stroke-primary" />
        <circle r="3" className="fill-primary" />
        <circle cx={hand.x} cy={hand.y} r="15" className="fill-primary" />
        {mode === "minute" && time.minute % 5 !== 0 ? (
          <circle cx={hand.x} cy={hand.y} r="2" className="fill-primary-foreground" />
        ) : null}
        {dialLabels(mode, hour12).map((entry) => {
          const active =
            entry.selects.slot === selected.slot &&
            (hour12 || entry.selects.inner === selected.inner);
          return (
            <text
              key={entry.key}
              x={entry.x}
              y={entry.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={entry.selects.inner ? 11 : 13}
              className={cn(
                "pointer-events-none tabular-nums",
                active
                  ? "fill-primary-foreground"
                  : entry.selects.inner
                    ? "fill-muted-foreground"
                    : "fill-foreground",
              )}
            >
              {entry.label}
            </text>
          );
        })}
      </svg>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={props.onCancel}>
          <T>Cancel</T>
        </Button>
        <Button type="button" size="sm" onClick={() => props.onConfirm(time)}>
          <T>OK</T>
        </Button>
      </div>
    </div>
  );
}

export { TimeInput, type TimeInputProps };
