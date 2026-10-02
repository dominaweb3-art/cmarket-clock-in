/** Local Android QA signing only. Not a production deployment approval.
 * Never reads wallet keys. QA certificate/password live only in ignored storage.
 * No password is printed or placed in command arguments or tracked files.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
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
const signing = join(root, "release-signing"),
  dist = join(root, "dist/release");
mkdirSync(signing, { recursive: true, mode: 0o700 });
mkdirSync(dist, { recursive: true });
const password = join(signing, "qa.password"),
  keystore = join(signing, "qa.keystore");
if (existsSync(keystore) && !existsSync(password))
  throw new Error("QA_SIGNING_PASSWORD_MISSING");
if (!existsSync(keystore)) {
  writeFileSync(password, randomBytes(32).toString("hex"), {
    mode: 0o600,
    flag: "wx",
  });
  execFileSync(
    "keytool",
    [
      "-genkeypair",
      "-keystore",
      keystore,
      "-storetype",
      "PKCS12",
      "-storepass:file",
      password,
      "-keypass:file",
      password,
      "-alias",
      "c3-pilot-qa",
      "-keyalg",
      "RSA",
      "-keysize",
      "3072",
      "-validity",
      "3650",
      "-dname",
      "CN=C Market C3 QA ONLY, O=C Market, C=CO",
      "-noprompt",
    ],
    { stdio: "pipe" },
  );
}
const init = join(dist, "qa-signing.init.gradle");
writeFileSync(
  init,
  `allprojects { p ->
  p.afterEvaluate {
    if (p.path == ':app' && p.plugins.hasPlugin('com.android.application')) {
      def base = new File(System.getenv('C3_ANDROID_QA_SIGNING_DIR'))
      def secret = new File(base, 'qa.password').text.trim()
      def signing = p.android.signingConfigs.create('c3IsolatedQa')
      signing.storeFile = new File(base, 'qa.keystore')
      signing.storePassword = secret
      signing.keyAlias = 'c3-pilot-qa'
      signing.keyPassword = secret
      p.android.buildTypes.release.signingConfig = signing
    }
  }
}`,
);
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error("ANDROID_SDK_REQUIRED");
const env = {
  ...process.env,
  NODE_ENV: "production",
  C3_ANDROID_QA_SIGNING_DIR: signing,
  EXPO_PUBLIC_C3_READ_ONLY_BACKEND_URL: "http://127.0.0.1:8787",
};
const run = spawnSync("./gradlew", ["--init-script", init, "assembleRelease"], {
  cwd: join(root, "android"),
  env,
  stdio: "inherit",
});
if (run.status !== 0) process.exit(run.status ?? 1);
const output = join(dist, "c-market-c3-pilot-0.1.1-local-cycle-qa.apk");
copyFileSync(
  join(root, "android/app/build/outputs/apk/release/app-release.apk"),
  output,
);
const hash = createHash("sha256").update(readFileSync(output)).digest("hex");
writeFileSync(
  output + ".sha256",
  `${hash}  c-market-c3-pilot-0.1.1-local-cycle-qa.apk\n`,
);
console.log(
  `QA_APK=${output}\nSHA256=${hash}\nCERTIFICATE_SCOPE=LOCAL_QA_ONLY`,
);
