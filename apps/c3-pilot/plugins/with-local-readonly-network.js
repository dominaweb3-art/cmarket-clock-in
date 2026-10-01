const {
  withAndroidManifest,
  withDangerousMod,
} = require("expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");
module.exports = function (config) {
  config = withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application[0];
    app.$["android:usesCleartextTraffic"] = "false";
    app.$["android:networkSecurityConfig"] = "@xml/c3_readonly_network";
    return mod;
  });
  return withDangerousMod(config, [
    "android",
    async (mod) => {
      const directory = path.join(
        mod.modRequest.platformProjectRoot,
        "app/src/main/res/xml",
      );
      await fs.mkdir(directory, { recursive: true });
      // USB adb reverse may expose ONLY the read-only loopback test server.
      // All public traffic requires HTTPS; this does not enable local RPC/trading.
      await fs.writeFile(
        path.join(directory, "c3_readonly_network.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">127.0.0.1</domain></domain-config></network-security-config>`,
      );
      return mod;
    },
  ]);
};
