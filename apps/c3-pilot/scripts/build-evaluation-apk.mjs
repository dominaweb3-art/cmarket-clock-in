/** Separate AUTH-QA artifact, not completed evaluation. Never installs, signs
 * blockchain transactions, generates identities or replaces prior artifacts. */
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
const project = join(root, "variants/evaluation");
const dist = join(root, "dist/devnet-evaluation-auth-qa-v2");
const signing = join(root, "release-signing");
const apk = join(dist, "c-market-c3-devnet-auth-qa-0.1.1.apk");
if (existsSync(apk)) throw Error("EVAL_PRESERVE_EXISTING_APK");
if (
  !existsSync(join(signing, "qa.keystore")) ||
  !existsSync(join(signing, "qa.password"))
)
  throw Error("EVAL_EXISTING_CERTIFICATE_REQUIRED");
if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT)
  throw Error("EVAL_ANDROID_SDK_REQUIRED");
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
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) throw Error("EVAL_BUILD_FAILED");
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
const init = join(dist, "evaluation-signing.init.gradle");
writeFileSync(
  init,
  `allprojects { p -> p.afterEvaluate {
 if (p.path == ':app' && p.plugins.hasPlugin('com.android.application')) {
  def base = new File(System.getenv('C3_ANDROID_QA_SIGNING_DIR'))
  def secret = new File(base, 'qa.password').text.trim()
  def signing = p.android.signingConfigs.create('c3EvaluationQa')
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
copyFileSync(
  join(project, "android/app/build/outputs/apk/release/app-release.apk"),
  apk,
);
const sha256 = createHash("sha256").update(readFileSync(apk)).digest("hex");
writeFileSync(
  apk + ".sha256",
  `${sha256}  c-market-c3-devnet-auth-qa-0.1.1.apk\n`,
);
console.log(
  JSON.stringify({
    apk,
    sha256,
    mainnetEnabled: false,
    evaluationComplete: false,
    scope: "CONNECTION_MESSAGE_AUTH_QA_ONLY",
  }),
);
