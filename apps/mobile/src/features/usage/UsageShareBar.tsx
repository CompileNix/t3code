import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";

export interface ShareSegment {
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

/** Touch has no hover, so a tap on the label shows its hint below it. */
export function HintLabel(props: {
  readonly hint: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      accessibilityHint={props.hint}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      className="shrink gap-0.5"
      onPress={() => setOpen((value) => !value)}
    >
      <Text className={`${props.className ?? ""} underline decoration-dotted`}>
        {props.children}
      </Text>
      {open ? <Text className="text-xs text-foreground-muted">{props.hint}</Text> : null}
    </Pressable>
  );
}

export function UsageShareBar(props: {
  readonly label: string;
  readonly hint?: string;
  readonly segments: readonly ShareSegment[];
  readonly format: (value: number) => string;
  readonly aside?: string;
}) {
  const visible = props.segments.filter((segment) => segment.value > 0);
  if (visible.length === 0) return null;

  return (
    <View className="gap-3 p-4">
      <View className="flex-row items-baseline justify-between gap-3">
        {props.hint === undefined ? (
          <Text className="text-sm text-foreground-muted">{props.label}</Text>
        ) : (
          <HintLabel hint={props.hint} className="text-sm text-foreground-muted">
            {props.label}
          </HintLabel>
        )}
        {props.aside ? (
          <Text className="text-sm tabular-nums text-foreground-muted">{props.aside}</Text>
        ) : null}
      </View>
      <View className="h-2 flex-row gap-0.5">
        {visible.map((segment) => (
          <View
            key={segment.label}
            className="h-full rounded-sm"
            style={{ flex: segment.value, backgroundColor: segment.color }}
          />
        ))}
      </View>
      <View className="flex-row flex-wrap gap-x-4 gap-y-1.5">
        {visible.map((segment) => (
          <View key={segment.label} className="flex-row items-center gap-1.5">
            <View className="size-2 rounded-sm" style={{ backgroundColor: segment.color }} />
            <Text className="text-sm text-foreground-muted">{segment.label}</Text>
            <Text className="text-sm tabular-nums text-foreground">
              {props.format(segment.value)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
