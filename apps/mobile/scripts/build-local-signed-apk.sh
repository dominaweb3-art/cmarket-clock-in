#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile_dir="$(cd "${script_dir}/.." && pwd)"
signing_dir="${mobile_dir}/release-signing"
keystore_path="${signing_dir}/cmarket-release.keystore"
password_path="${signing_dir}/cmarket-release.password"
key_alias="cmarket-release"
app_version="$(cd "${mobile_dir}" && node -p "require('./app.json').expo.version")"
apk_name="c-market-${app_version}-release.apk"
apk_source="${mobile_dir}/android/app/build/outputs/apk/release/app-release.apk"
apk_output_dir="${mobile_dir}/dist/release"
apk_output="${apk_output_dir}/${apk_name}"

umask 077
mkdir -p "${signing_dir}" "${apk_output_dir}"

if [[ -e "${keystore_path}" && ! -s "${password_path}" ]]; then
  echo "Signing keystore exists but its local password file is missing." >&2
  exit 1
fi

if [[ ! -e "${keystore_path}" ]]; then
  signing_password="$(openssl rand -hex 24)"
  printf '%s\n' "${signing_password}" > "${password_path}"

  keytool -genkeypair \
    -keystore "${keystore_path}" \
    -storetype PKCS12 \
    -storepass "${signing_password}" \
    -keypass "${signing_password}" \
    -alias "${key_alias}" \
    -keyalg RSA \
    -keysize 4096 \
    -validity 10000 \
    -dname "CN=C Market, OU=Android Release, O=Domina Web3, L=Bogota, ST=Bogota, C=CO" \
    -noprompt
fi

IFS= read -r signing_password < "${password_path}"

cd "${mobile_dir}"
NODE_ENV=production npx expo prebuild --platform android --clean --no-install

cd "${mobile_dir}/android"
NODE_ENV=production ./gradlew assembleRelease \
  -Pandroid.injected.signing.store.file="${keystore_path}" \
  -Pandroid.injected.signing.store.password="${signing_password}" \
  -Pandroid.injected.signing.key.alias="${key_alias}" \
  -Pandroid.injected.signing.key.password="${signing_password}"

cp "${apk_source}" "${apk_output}"

android_sdk_dir="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "${android_sdk_dir}" ]]; then
  echo "ANDROID_HOME or ANDROID_SDK_ROOT is required to verify the APK signature." >&2
  exit 1
fi

apksigner_path="$(find "${android_sdk_dir}/build-tools" -type f -name apksigner -print | sort -V | tail -n 1)"
if [[ -z "${apksigner_path}" ]]; then
  echo "Android apksigner was not found under the configured SDK." >&2
  exit 1
fi

"${apksigner_path}" verify --verbose "${apk_output}"
printf 'SIGNED_APK=%s\n' "${apk_output}"
