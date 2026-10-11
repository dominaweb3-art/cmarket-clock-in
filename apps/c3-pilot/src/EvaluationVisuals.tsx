import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { evalText } from "./evaluation-locales";
import {
  evaluationTabs,
  evaluationTargets,
  visualText,
  type EvaluationTab,
} from "./evaluation-visual-copy";
import type { Language } from "./locales";

// Native vector-like geometry: no font-dependent emoji or extra UI dependency.
export function NavigationGlyph({
  name,
  color = "#76808d",
}: {
  name: EvaluationTab | "wallet" | "markets";
  color?: string;
}) {
  if (name === "indices")
    return (
      <View accessible={false} style={s.glyph}>
        {[12, 22, 29].map((height, i) => (
          <View
            key={height}
            style={{
              position: "absolute",
              bottom: 2,
              left: i * 11,
              width: 7,
              height,
              borderRadius: 3,
              backgroundColor: color,
            }}
          />
        ))}
      </View>
    );
  if (name === "home")
    return (
      <View accessible={false} style={s.glyph}>
        <View style={[s.roof, { backgroundColor: color }]} />
        <View style={[s.house, { backgroundColor: color }]} />
        <View style={s.door} />
      </View>
    );
  if (name === "wallet")
    return (
      <View accessible={false} style={s.glyph}>
        <View style={[s.wallet, { borderColor: color }]} />
        <View style={[s.walletFlap, { borderColor: color }]} />
        <View style={[s.walletDot, { backgroundColor: color }]} />
      </View>
    );
  return (
    <View accessible={false} style={s.glyph}>
      <View style={[s.circle, { borderColor: color }]} />
      {name === "activity" ? (
        <>
          <View style={[s.clockLong, { backgroundColor: color }]} />
          <View style={[s.clockShort, { backgroundColor: color }]} />
        </>
      ) : (
        <>
          <View style={[s.meridian, { borderColor: color }]} />
          <View style={[s.equator, { backgroundColor: color }]} />
        </>
      )}
    </View>
  );
}

export function BottomNavigation({
  language,
  tab,
  onChange,
}: {
  language: Language;
  tab: EvaluationTab;
  onChange: (tab: EvaluationTab) => void;
}) {
  return (
    <View testID="evaluation-bottom-navigation" style={s.navigation}>
      {evaluationTabs.map((value) => (
        <Pressable
          key={value}
          testID={`evaluation-tab-${value}`}
          accessibilityRole="tab"
          accessibilityLabel={evalText(language, value)}
          accessibilityState={{ selected: tab === value }}
          onPress={() => onChange(value)}
          style={s.tab}
        >
          <NavigationGlyph
            name={value}
            color={tab === value ? "#075c47" : "#76808d"}
          />
          <Text style={[s.tabLabel, tab === value && s.active]}>
            {evalText(language, value)}
          </Text>
          <View style={[s.indicator, tab === value && s.activeIndicator]} />
        </Pressable>
      ))}
    </View>
  );
}

export function CryptoIcon({ index }: { index: number }) {
  // Crop in the view, not the source: all approved pixels/proportions preserved.
  return (
    <View accessible={false} style={s.crop}>
      <Image
        source={require("../assets/evaluation-ui/crypto-sprite-v1.png")}
        style={[s.sprite, { left: -index * 56 }]}
      />
    </View>
  );
}

export function C3Summary({
  language,
  onExplore,
  onDetails,
  disabled = false,
}: {
  language: Language;
  onExplore: () => void;
  onDetails?: () => void;
  disabled?: boolean;
}) {
  const t = (key: Parameters<typeof visualText>[1]) =>
    visualText(language, key);
  return (
    <View style={s.c3Card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("view")}
        disabled={!onDetails}
        onPress={onDetails}
        style={s.cardHeading}
      >
        <Text style={s.c3}>C3</Text>
        <Text style={s.indexTitle}>· {t("index")}</Text>
        {onDetails ? <Text style={s.chevron}>›</Text> : null}
      </Pressable>
      <Text style={s.caption}>{t("allocation")}</Text>
      <View style={s.assets}>
        {evaluationTargets.map((asset) => (
          <View
            key={asset.symbol}
            style={[s.asset, { backgroundColor: asset.background }]}
          >
            <CryptoIcon index={asset.icon} />
            <Text style={s.percent}>{asset.percent}%</Text>
            <Text style={s.symbol}>{asset.symbol}</Text>
            <Text style={s.test}>{t("test")}</Text>
          </View>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("buy")}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onExplore}
        style={[s.cta, disabled && { opacity: 0.45 }]}
      >
        <Text style={s.ctaText}>{t("buy")}</Text>
      </Pressable>
      <View style={s.explanation}>
        <Text style={s.what}>{t("what")}</Text>
        <Text style={s.description}>{t("description")}</Text>
      </View>
    </View>
  );
}

export function UpcomingIndices({ language }: { language: Language }) {
  const t = (key: Parameters<typeof visualText>[1]) =>
    visualText(language, key);
  return (
    <View style={s.upcoming}>
      <Text style={s.sectionHeading}>{t("more")}</Text>
      <View style={s.tiles}>
        {["C5", "C10", "C20", "C50"].map((symbol) => (
          <View key={symbol} style={s.tile}>
            <Text style={s.tileTitle}>{symbol}</Text>
            <NavigationGlyph name="indices" color="#a1a8b3" />
            <Text style={s.soon}>{t("soon")}</Text>
          </View>
        ))}
      </View>
      <View style={s.market}>
        <NavigationGlyph name="markets" />
        <Text style={s.marketTitle}>{t("markets")}</Text>
        <Text style={s.marketBadge}>{t("soon")}</Text>
      </View>
    </View>
  );
}

export function EmptyActivity({ language }: { language: Language }) {
  return (
    <View style={s.empty}>
      <Image
        source={require("../assets/evaluation-ui/activity-empty-v1.png")}
        style={s.emptyImage}
        accessible={false}
      />
      <Text style={s.what}>{evalText(language, "noActivity")}</Text>
      <Text style={s.description}>{visualText(language, "activityHint")}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  glyph: { width: 32, height: 32 },
  roof: {
    width: 23,
    height: 23,
    top: 1,
    left: 4,
    transform: [{ rotate: "45deg" }],
    borderRadius: 3,
    position: "absolute",
  },
  house: {
    width: 27,
    height: 21,
    top: 11,
    left: 2,
    borderRadius: 3,
    position: "absolute",
  },
  door: {
    position: "absolute",
    width: 7,
    height: 11,
    bottom: 0,
    left: 12,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    backgroundColor: "#fff",
  },
  circle: {
    width: 30,
    height: 30,
    borderWidth: 2.5,
    borderRadius: 15,
    top: 1,
    left: 1,
    position: "absolute",
  },
  clockLong: {
    width: 2.5,
    height: 10,
    left: 15,
    top: 6,
    borderRadius: 2,
    position: "absolute",
  },
  clockShort: {
    width: 10,
    height: 2.5,
    left: 15,
    top: 15,
    transform: [{ rotate: "35deg" }],
    transformOrigin: "left",
    position: "absolute",
  },
  meridian: {
    width: 12,
    height: 30,
    borderWidth: 2,
    borderRadius: 12,
    left: 10,
    top: 1,
    position: "absolute",
  },
  equator: { width: 28, height: 2, left: 2, top: 15, position: "absolute" },
  wallet: {
    width: 29,
    height: 23,
    borderWidth: 2,
    borderRadius: 4,
    top: 5,
    position: "absolute",
  },
  walletFlap: {
    width: 11,
    height: 10,
    borderWidth: 2,
    borderRadius: 3,
    right: 0,
    top: 12,
    backgroundColor: "#f3f5f7",
    position: "absolute",
  },
  walletDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    right: 4,
    top: 16,
    position: "absolute",
  },
  navigation: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderTopColor: "#e8eded",
    borderTopWidth: 1,
    paddingTop: 10,
    paddingBottom: 4,
    flexShrink: 0,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 70,
    paddingHorizontal: 4,
    gap: 5,
  },
  tabLabel: { color: "#76808d", fontSize: 14, textAlign: "center" },
  active: { color: "#075c47", fontWeight: "700" },
  indicator: { height: 3, width: 34, borderRadius: 3, marginTop: 1 },
  activeIndicator: { backgroundColor: "#075c47" },
  c3Card: {
    backgroundColor: "#fbfefd",
    borderWidth: 1,
    borderColor: "#deeee8",
    borderRadius: 24,
    padding: 18,
  },
  cardHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 48,
  },
  c3: { fontSize: 34, fontWeight: "800", color: "#0b1221" },
  indexTitle: { flex: 1, fontSize: 22, fontWeight: "700", color: "#0b1221" },
  chevron: { fontSize: 36, color: "#788290" },
  caption: { fontSize: 12, color: "#5b686f", marginTop: 5, marginBottom: 14 },
  assets: { flexDirection: "row", gap: 8 },
  asset: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 2,
    borderRadius: 16,
    gap: 3,
  },
  crop: { width: 56, height: 56, overflow: "hidden" },
  sprite: {
    position: "absolute",
    width: 224,
    height: 224 / 3,
    top: -(224 / 3 - 56) / 2,
  },
  percent: { fontWeight: "800", color: "#0b1221", fontSize: 24 },
  symbol: { fontSize: 15, color: "#566171" },
  test: {
    fontSize: 9,
    fontWeight: "600",
    color: "#667079",
    letterSpacing: 0.5,
  },
  cta: {
    backgroundColor: "#075c47",
    borderRadius: 14,
    minHeight: 54,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  ctaText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  explanation: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderColor: "#e3edeb",
    gap: 6,
  },
  what: { fontSize: 18, color: "#0b1221", fontWeight: "700" },
  description: { fontSize: 14, lineHeight: 21, color: "#626c79" },
  upcoming: { marginTop: 24 },
  sectionHeading: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0b1221",
    marginBottom: 14,
  },
  tiles: { flexDirection: "row", gap: 7 },
  tile: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: "#f3f5f7",
    minHeight: 124,
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 2,
    gap: 10,
  },
  tileTitle: { color: "#182031", fontSize: 19, fontWeight: "700" },
  soon: { fontSize: 10, color: "#657080", textAlign: "center" },
  market: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
    backgroundColor: "#f3f5f7",
    borderRadius: 16,
    padding: 16,
    marginTop: 10,
  },
  marketTitle: { color: "#525e6c", fontSize: 17, flex: 1 },
  marketBadge: {
    color: "#667079",
    fontSize: 11,
    backgroundColor: "#e6e9ed",
    padding: 8,
    borderRadius: 20,
  },
  empty: { alignItems: "center", gap: 12, paddingVertical: 20 },
  emptyImage: { width: 110, height: 110 },
});
