import { useGT } from "gt-react";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { weekStartsOn } from "~/timestampFormat";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { dateValue, dropdownRange, parseDateValue } from "./date-input.logic";
import { Popover, PopoverPopup, PopoverTrigger } from "./popover";

type DateInputProps = {
  id?: string;
  className?: string;
  disabled?: boolean;
  /** `YYYY-MM-DD`, like a native date input, or empty when unset. */
  value: string;
  onValueChange: (value: string) => void;
  /** Days before this one cannot be picked. */
  min?: Date;
  "aria-label"?: string;
  /** Accessible name of the calendar popup. */
  popupLabel?: string;
};

// A native date input shows the OS's segmented day/month/year field, which looks out of place
// next to the app's own controls. This opens the app calendar, with month and year dropdowns.
function DateInput({
  id,
  className,
  disabled,
  value,
  onValueChange,
  min,
  popupLabel,
  ...props
}: DateInputProps) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const selected = parseDateValue(value);
  const label = gt("Choose date", { $context: "calendar date" });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={props["aria-label"]}
            className={cn("justify-between font-normal", className)}
          />
        }
      >
        <span className={cn("truncate", selected === null && "text-muted-foreground")}>
          {selected === null
            ? gt("Pick a date")
            : selected.toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
        </span>
        <CalendarIcon className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverPopup align="start" aria-label={popupLabel ?? label}>
        <DateInputCalendar
          selected={selected}
          {...(min === undefined ? {} : { min })}
          onSelect={(date) => {
            setOpen(false);
            const next = dateValue(date);
            if (next !== value) onValueChange(next);
          }}
        />
      </PopoverPopup>
    </Popover>
  );
}

function DateInputCalendar(props: {
  selected: Date | null;
  min?: Date;
  onSelect: (date: Date) => void;
}) {
  const nowMinute = useNowMinute();
  const now = new Date(Date.parse(`${nowMinute}Z`));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return (
    <Calendar
      mode="single"
      required
      captionLayout="dropdown"
      {...dropdownRange(props.selected, today)}
      selected={props.selected ?? undefined}
      defaultMonth={props.selected ?? props.min ?? today}
      {...(weekStartsOn === undefined ? {} : { weekStartsOn })}
      {...(props.min === undefined ? {} : { disabled: { before: props.min } })}
      onSelect={(date: Date | undefined) => {
        if (date) props.onSelect(date);
      }}
    />
  );
}

export { DateInput, type DateInputProps };
