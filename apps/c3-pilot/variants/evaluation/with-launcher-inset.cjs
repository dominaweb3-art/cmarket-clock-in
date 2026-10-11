const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");

// Keep the approved bitmap unchanged. Android adaptive icons magnify their
// foreground; inset only the launcher drawable to preserve the complete mark.
module.exports = (config) =>
  withDangerousMod(config, [
    "android",
    async (mod) => {
      const res = path.join(
        mod.modRequest.platformProjectRoot,
        "app/src/main/res",
      );
      await fs.writeFile(
        path.join(res, "drawable/cmarket_launcher_foreground.xml"),
        '<?xml version="1.0" encoding="utf-8"?>\n<inset xmlns:android="http://schemas.android.com/apk/res/android" android:inset="20%"><bitmap android:src="@mipmap/ic_launcher_foreground" android:gravity="fill" /></inset>\n',
      );
      for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
        const file = path.join(res, "mipmap-anydpi-v26", name);
        const xml = await fs.readFile(file, "utf8");
        await fs.writeFile(
          file,
          xml.replaceAll(
            "@mipmap/ic_launcher_foreground",
            "@drawable/cmarket_launcher_foreground",
          ),
        );
      }
      return mod;
    },
  ]);
