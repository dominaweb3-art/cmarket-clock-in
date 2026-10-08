/** Non-monetary UI checks only. No wallet buttons, Wi-Fi changes, uninstall,
 * data clearing, or transaction/session credential logging. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const adb = "/Users/juantorres/Library/Android/sdk/platform-tools/adb";
const pkg = "com.dominaweb3.cmarket.c3evaluation";
const directory = fileURLToPath(
  new URL("../../../artifacts/c3-devnet-evaluation/seeker/", import.meta.url),
);
mkdirSync(directory, { recursive: true });
const command = (...args) => execFileSync(adb, args, { encoding: "utf8" });
const pause = () => new Promise((resolve) => setTimeout(resolve, 600));
const window = () => {
  command("shell", "uiautomator", "dump", "/sdcard/c3-evaluation-window.xml");
  const xml = command("shell", "cat", "/sdcard/c3-evaluation-window.xml");
  if (!xml.includes(`package="${pkg}"`))
    throw Error("EVAL_WRONG_FOREGROUND_APP");
  return xml;
};
function tap(label) {
  const node = window().match(
    new RegExp(
      `<node [^>]*content-desc="${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
    ),
  );
  if (!node) throw Error("EVAL_UI_TARGET_MISSING:" + label);
  command(
    "shell",
    "input",
    "tap",
    String(Math.floor((Number(node[1]) + Number(node[3])) / 2)),
    String(Math.floor((Number(node[2]) + Number(node[4])) / 2)),
  );
}
function capture(name) {
  writeFileSync(
    directory + name + ".png",
    execFileSync(adb, ["exec-out", "screencap", "-p"]),
  );
}
const checks = [];
for (const [label, notice, indices, activity] of [
  ["English", "Solana Devnet evaluation", "Indices", "Activity"],
  ["Español", "Evaluación Solana Devnet", "Índices", "Actividad"],
  ["简体中文", "Solana Devnet 评估", "指数", "活动"],
  ["Português (Brasil)", "Avaliação Solana Devnet", "Índices", "Atividade"],
]) {
  tap(label);
  await pause();
  if (!window().includes(notice)) throw Error("EVAL_TRANSLATION_FAILED");
  tap(indices);
  await pause();
  if (!window().includes("40% / 30% / 30%"))
    throw Error("EVAL_ALLOCATION_MISSING");
  capture("indices-" + checks.length);
  tap(activity);
  await pause();
  capture("activity-" + checks.length);
  checks.push({
    language: label,
    notice: true,
    navigation: true,
    allocation: true,
  });
}
command("shell", "am", "force-stop", pkg);
command("shell", "am", "start", "-n", pkg + "/.MainActivity");
await pause();
if (!window().includes("Avaliação Solana Devnet"))
  throw Error("EVAL_LANGUAGE_NOT_PERSISTED");
capture("restart-persistence");
tap("Español");
await pause();
tap("Comprobar backend alojado");
await new Promise((r) => setTimeout(r, 3000));
command("shell", "input", "swipe", "600", "2350", "600", "700", "500");
await pause();
const health = window().includes(
  "Base de datos alojada y Solana Devnet accesibles",
);
capture("hosted-health");
const report = {
  checkedAt: new Date().toISOString(),
  package: pkg,
  checks,
  persistedLanguage: true,
  hostedHealthVisible: health,
  walletInvoked: false,
  transactionsRequested: false,
  fullCycleVerified: false,
};
writeFileSync(directory + "visual-qa.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!health) process.exitCode = 1;
