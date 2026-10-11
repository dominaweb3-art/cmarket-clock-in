import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/** Closed by default. Expansion never starts a request or wallet operation. */
export function EvaluationAccordion({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={s.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((v) => !v)}
        style={s.trigger}
      >
        <Text style={s.title}>{title}</Text>
        <Text accessible={false} style={s.indicator}>
          {expanded ? "−" : "+"}
        </Text>
      </Pressable>
      {expanded ? <View style={s.content}>{children}</View> : null}
    </View>
  );
}
const s = StyleSheet.create({
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
