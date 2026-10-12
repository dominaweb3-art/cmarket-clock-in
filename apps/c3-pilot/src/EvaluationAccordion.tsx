import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/** Closed by default. Expansion never starts a request or wallet operation. */
export function EvaluationAccordion({
  title,
  children,
  expanded: controlledExpanded,
  onToggle,
  inline = false,
}: {
  title: string;
  children: ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
  inline?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const open = controlledExpanded ?? expanded;
  return (
    <View style={inline ? s.inline : s.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          if (onToggle) onToggle();
          else setExpanded((v) => !v);
        }}
        style={s.trigger}
      >
        <Text style={s.title}>{title}</Text>
        <Text accessible={false} style={s.indicator}>
          {open ? "−" : "+"}
        </Text>
      </Pressable>
      {open ? <View style={s.content}>{children}</View> : null}
    </View>
  );
}
const s = StyleSheet.create({
  inline: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#e3ebe7" },
  section: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e3ebe7",
    borderRadius: 16,
    marginTop: 12,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    padding: 16,
  },
  title: {
    flex: 1,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "600",
    color: "#102b25",
  },
  indicator: { fontSize: 24, color: "#075c47" },
  content: { paddingHorizontal: 16, paddingBottom: 16 },
});
