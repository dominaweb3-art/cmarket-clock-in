import { useRef, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

const slides = [
  {
    title: "The crypto market.\nAll in one place.",
    body: "Discover digital asset baskets through a simple, clear, on-chain experience.",
    image: require("../assets/onboarding/crypto-white.png"),
    footer: "On-chain indices for a better future.",
  },
  {
    title: "A world of markets.\nOne platform.",
    body: "We start with crypto indices. Our vision is to connect global markets through tokenized indices.",
    image: require("../assets/onboarding/global-white.png"),
    footer: "Global markets are our vision · Coming soon.",
  },
  {
    title: "Your journey\nstarts with C3.",
    body: "Connect your wallet and discover our first digital asset basket.",
    image: require("../assets/onboarding/connect-white.png"),
    footer: "Simple. Transparent. On-chain.",
  },
];

/** Welcome only. Wallet connection reuses MWA; no deposit or proof signature. */
export function EvaluationOnboarding({
  busy,
  status,
  onConnect,
  onExplore,
}: {
  busy: boolean;
  status: string;
  onConnect: () => void;
  onExplore: () => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const list = useRef<FlatList>(null);
  const [page, setPage] = useState(0);
  return (
    <SafeAreaView style={s.root} testID="evaluation-onboarding">
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <FlatList
        ref={list}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, index) => String(index)}
        extraData={{ width, busy, status }}
        onMomentumScrollEnd={(event) =>
          setPage(
            Math.max(
              0,
              Math.min(
                2,
                Math.round(event.nativeEvent.contentOffset.x / width),
              ),
            ),
          )
        }
        renderItem={({ item, index }) => (
          <ScrollView
            style={{ width }}
            contentContainerStyle={s.slide}
            showsVerticalScrollIndicator={false}
          >
            <View style={s.brand}>
              <Image
                source={require("../../mobile/assets/images/splash-icon.png")}
                style={s.logo}
                accessible={false}
              />
              <Text style={s.brandName}>C Market</Text>
            </View>
            <Text style={s.notice}>Demo · Devnet · Test tokens only</Text>
            <Text
              accessibilityRole="header"
              style={[s.title, { fontSize: width < 360 ? 27 : 32 }]}
            >
              {item.title}
            </Text>
            <Text style={s.body}>{item.body}</Text>
            <Image
              source={item.image}
              accessible={false}
              resizeMode="contain"
              style={[
                s.art,
                {
                  height: Math.min(400, width * 0.95),
                  minHeight: fontScale > 1.3 ? 180 : 240,
                },
              ]}
            />
            {index === 2 ? (
              <>
                <Pressable
                  testID="onboarding-connect"
                  accessibilityRole="button"
                  accessibilityLabel="Connect wallet"
                  disabled={busy}
                  accessibilityState={{ disabled: busy }}
                  onPress={onConnect}
                  style={[s.button, busy && s.disabled]}
                >
                  <Text style={s.buttonText}>
                    {busy ? "Connecting…" : "Connect wallet"}
                  </Text>
                </Pressable>
                {status ? (
                  <Text accessibilityLiveRegion="polite" style={s.body}>
                    {status}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={onExplore}
                  style={s.explore}
                >
                  <Text style={s.exploreText}>Explore first</Text>
                </Pressable>
              </>
            ) : null}
            <Text style={s.footer}>{item.footer}</Text>
          </ScrollView>
        )}
      />
      <View
        style={s.dots}
        accessibilityLabel={`Welcome screen ${page + 1} of 3`}
      >
        {slides.map((_, index) => (
          <Pressable
            key={index}
            accessibilityRole="button"
            accessibilityLabel={`Go to welcome screen ${index + 1}`}
            accessibilityState={{ selected: page === index }}
            onPress={() => {
              list.current?.scrollToOffset({
                offset: width * index,
                animated: true,
              });
              setPage(index);
            }}
            style={s.dotTouch}
          >
            <View style={[s.dot, page === index && s.activeDot]} />
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
  slide: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 12,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  logo: { width: 52, height: 52, borderRadius: 12 },
  brandName: { color: "#0b1221", fontSize: 30, fontWeight: "800" },
  notice: {
    color: "#075c47",
    fontSize: 11,
    textAlign: "center",
    marginBottom: 20,
  },
  title: {
    color: "#0b1221",
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 14,
  },
  body: {
    color: "#52685e",
    fontSize: 16,
    lineHeight: 23,
    textAlign: "center",
    maxWidth: 480,
  },
  art: { width: "100%", maxWidth: 480, marginVertical: 8 },
  button: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "#00e1d2",
    minHeight: 56,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  buttonText: { color: "#031215", fontWeight: "800", fontSize: 19 },
  disabled: { opacity: 0.55 },
  explore: { minHeight: 48, justifyContent: "center", paddingHorizontal: 16 },
  exploreText: { color: "#075c47", fontSize: 14 },
  footer: {
    color: "#52685e",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    paddingTop: 8,
  },
  dots: { flexDirection: "row", justifyContent: "center", paddingBottom: 8 },
  dotTouch: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#cbdad2" },
  activeDot: {
    backgroundColor: "#00e1d2",
    width: 11,
    height: 11,
    borderRadius: 6,
  },
});
