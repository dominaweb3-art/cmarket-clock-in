/** Non-monetary visual QA only. Whitelisted navigation, accordion and language
 * taps. No connect/verify/deposit, data clearing, network changes or wallet calls. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { languageLabels, languages } from "../src/locales.ts";
import { visualText } from "../src/evaluation-visual-copy.ts";
import { homeText } from "../src/evaluation-home-copy.ts";
import { activityText } from "../src/evaluation-activity-copy.ts";
import { indicesText } from "../src/evaluation-indices-copy.ts";
import { evalText } from "../src/evaluation-locales.ts";

const adb = "/Users/juantorres/Library/Android/sdk/platform-tools/adb";
const pkg = "com.dominaweb3.cmarket.c3evaluation";
const dir = fileURLToPath(
  new URL("../dist/devnet-evaluation-ui-v17/seeker-visual/", import.meta.url),
);
const command = (...args) => execFileSync(adb, args, { encoding: "utf8" });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const decode = (s) =>
  s
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
const allowed = new Set(Object.values(languageLabels));
const tabs = {
  en: ["Home", "Indices", "Activity"],
  es: ["Inicio", "Índices", "Actividad"],
  "zh-CN": ["首页", "指数", "活动"],
  "pt-BR": ["Início", "Índices", "Atividade"],
};
for (const l of languages) {
  for (const label of tabs[l]) allowed.add(label);
  allowed.add(visualText(l, "account"));
  allowed.add(indicesText(l, "close"));
  allowed.add(`${indicesText(l, "language")} · ${languageLabels[l]}`);
  allowed.add(homeText(l, "how"));
  allowed.add(homeText(l, "explore"));
  allowed.add(activityText(l, "help"));
  allowed.add(indicesText(l, "composition"));
}
mkdirSync(dir, { recursive: true });
const dimensions = command("shell", "wm", "size").match(
  /(?:Physical|Override) size: (\d+)x(\d+)/,
);
if (!dimensions) throw Error("EVAL_SCREEN_DIMENSIONS_REQUIRED");
const [width, height] = [Number(dimensions[1]), Number(dimensions[2])];
function screen() {
  command("shell", "uiautomator", "dump", "/sdcard/c3-visual-window.xml");
  const xml = command("shell", "cat", "/sdcard/c3-visual-window.xml");
  if (!xml.includes(`package="${pkg}"`))
    throw Error("EVAL_APP_NOT_FOREGROUND_STOP");
  const nodes = [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) =>
    Object.fromEntries(
      [...tag.matchAll(/([a-z-]+)="([^"]*)"/g)].map(([, k, v]) => [
        k,
        decode(v),
      ]),
    ),
  );
  return nodes;
}
function visible(nodes, label) {
  return nodes.find((n) => n["content-desc"] === label || n.text === label);
}
function expect(nodes, text) {
  if (
    !nodes.some(
      (n) => n.text?.includes(text) || n["content-desc"]?.includes(text),
    )
  )
    throw Error("EVAL_VISUAL_COPY_MISSING:" + text);
}
async function tap(label, seek = false) {
  if (!allowed.has(label)) throw Error("EVAL_UNSAFE_TARGET_STOP");
  for (let attempt = 0; attempt < (seek ? 5 : 1); attempt++) {
    const n = visible(screen(), label),
      b = n?.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (
      b &&
      Number(b[3]) > Number(b[1]) &&
      Number(b[4]) > Number(b[2]) &&
      n.enabled !== "false"
    ) {
      command(
        "shell",
        "input",
        "tap",
        String(Math.floor((Number(b[1]) + Number(b[3])) / 2)),
        String(Math.floor((Number(b[2]) + Number(b[4])) / 2)),
      );
      await wait(400);
      return;
    }
    if (!seek) break;
    command(
      "shell",
      "input",
      "swipe",
      String(width / 2),
      String(Math.floor(height * 0.75)),
      String(width / 2),
      String(Math.floor(height * 0.32)),
      "350",
    );
    await wait(350);
  }
  throw Error("EVAL_VISUAL_TARGET_MISSING:" + label);
}
function capture(name) {
  writeFileSync(
    dir + name + ".png",
    execFileSync(adb, ["exec-out", "screencap", "-p"]),
  );
}
let current = languages.find((l) =>
  visible(screen(), visualText(l, "account")),
);
if (!current) throw Error("EVAL_LANGUAGE_UNDETERMINED");
const checks = [];
for (const l of languages) {
  await tap(visualText(current, "account"));
  if (!visible(screen(), languageLabels[l]))
    await tap(
      `${indicesText(current, "language")} · ${languageLabels[current]}`,
      true,
    );
  await tap(languageLabels[l]);
  current = l;
  await tap(indicesText(l, "close"));
  await tap(tabs[l][0]);
  expect(screen(), homeText(l, "title"));
  expect(screen(), evalText(l, "notice"));
  capture("home-" + l);
  await tap(homeText(l, "explore"));
  expect(screen(), indicesText(l, "subtitle"));
  await tap(tabs[l][2]);
  expect(screen(), activityText(l, "subtitle"));
  capture("activity-" + l);
  await tap(visualText(l, "account"));
  expect(screen(), indicesText(l, "language"));
  await tap(indicesText(l, "close"));
  await tap(tabs[l][1]);
  expect(screen(), "BTC 40%");
  expect(screen(), "ETH 30%");
  expect(screen(), "SOL 30%");
  capture("indices-" + l);
  await tap(visualText(l, "account"));
  await tap(indicesText(l, "close"));
  await tap(tabs[l][0]);
  await tap(visualText(l, "account"));
  await tap(indicesText(l, "close"));
  await tap(homeText(l, "how"), true);
  expect(screen(), homeText(l, "connectBody"));
  capture("home-how-" + l);
  await tap(tabs[l][1]);
  await tap(tabs[l][0]);
  await tap(homeText(l, "how"), true); // persists expanded across tab changes, now closes
  await tap(tabs[l][2]);
  await tap(activityText(l, "help"), true);
  expect(screen(), activityText(l, "helpBody"));
  capture("activity-help-" + l);
  await tap(activityText(l, "help"), true);
  checks.push({
    language: l,
    home: true,
    indices: true,
    activity: true,
    walletMenuAllTabs: true,
    passiveExplore: true,
    accordions: true,
  });
}
// Restore the owner's Spanish presentation and verify persisted language on a
// standalone cold launch. This intentionally does not preserve a memory session.
await tap(visualText(current, "account"));
if (!visible(screen(), languageLabels.es))
  await tap(
    `${indicesText(current, "language")} · ${languageLabels[current]}`,
    true,
  );
await tap(languageLabels.es);
await tap(indicesText("es", "close"));
command("shell", "am", "force-stop", pkg);
command("shell", "am", "start", "-n", pkg + "/.MainActivity");
await wait(1800);
expect(screen(), homeText("es", "title"));
capture("home-final-es");
const report = {
  checkedAt: new Date().toISOString(),
  package: pkg,
  version: "0.1.16",
  checks,
  coldLaunch: true,
  languagePersisted: true,
  monetaryActions: false,
  walletAuthorization: false,
  signing: false,
  completedHistoryOnDevice: false,
  pendingHistoryOnDevice: false,
  historyFixtureTests: "separate unit tests; not physical acceptance",
  screenshotsDirectory: dir,
};
writeFileSync(dir + "report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
