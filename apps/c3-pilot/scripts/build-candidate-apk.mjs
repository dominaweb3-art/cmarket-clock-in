/** Build a separate DISABLED candidate. Reuses the existing QA signing identity;
 * not production governance/signing approval. Never generates or prints secrets.
 * Never touches QA native project or existing APKs. No automatic install. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const qaBuild =
  process.argv.includes("--device-message-qa") ||
  process.argv.includes("--device-message-qa-monotonic");
const project = join(root, "variants/mainnet"),
  signing = join(root, "release-signing"),
  dist = join(
    root,
    process.argv.includes("--restricted-single-position")
      ? "dist/restricted-single-position-candidate"
      : process.argv.includes("--device-message-qa-monotonic")
        ? "dist/device-message-qa-monotonic-candidate"
        : process.argv.includes("--device-message-qa")
          ? "dist/device-message-qa-candidate"
          : "dist/mainnet-candidate",
  );
if (
  (qaBuild || process.argv.includes("--restricted-single-position")) &&
  existsSync(join(dist, "c-market-c3-mainnet-candidate-0.1.0-disabled.apk"))
)
  throw new Error("QA_ARTIFACT_ALREADY_EXISTS_PRESERVE_IT");
if (
  !existsSync(join(signing, "qa.keystore")) ||
  !existsSync(join(signing, "qa.password"))
)
  throw new Error("EXISTING_QA_SIGNING_REQUIRED");
if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT)
  throw new Error("ANDROID_SDK_REQUIRED");
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !k.startsWith("EXPO_PUBLIC_") && !k.startsWith("C3_"),
  ),
);
Object.assign(env, {
  NODE_ENV: "production",
  EXPO_NO_DOTENV: "1",
  C3_ANDROID_QA_SIGNING_DIR: signing,
});
const run = (file, args, cwd) => {
  const r = spawnSync(file, args, { cwd, env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
mkdirSync(dist, { recursive: true });
run(
  "node",
  [
    join(root, "node_modules/expo/bin/cli"),
    "prebuild",
    "--platform",
    "android",
    "--no-install",
  ],
  project,
);
const init = join(dist, "candidate-signing.init.gradle");
writeFileSync(
  init,
  `allprojects { p -> p.afterEvaluate {
 if (p.path == ':app' && p.plugins.hasPlugin('com.android.application')) {
  def base = new File(System.getenv('C3_ANDROID_QA_SIGNING_DIR'))
  def secret = new File(base, 'qa.password').text.trim()
  def signing = p.android.signingConfigs.create('c3CandidateQa')
  signing.storeFile = new File(base, 'qa.keystore')
  signing.storePassword = secret
  signing.keyAlias = 'c3-pilot-qa'
  signing.keyPassword = secret
  p.android.buildTypes.release.signingConfig = signing
 }
}}`,
);
run(
  "./gradlew",
  ["--init-script", init, "assembleRelease"],
  join(project, "android"),
);
const apk = join(dist, "c-market-c3-mainnet-candidate-0.1.0-disabled.apk");
copyFileSync(
  join(project, "android/app/build/outputs/apk/release/app-release.apk"),
  apk,
);
const hash = createHash("sha256").update(readFileSync(apk)).digest("hex");
writeFileSync(
  apk + ".sha256",
  `${hash}  c-market-c3-mainnet-candidate-0.1.0-disabled.apk\n`,
);
console.log(
  `CANDIDATE_APK=${apk}\nSHA256=${hash}\nEXECUTION=DISABLED\nCERTIFICATE_SCOPE=QA_NOT_PRODUCTION_APPROVAL`,
);
