# Android Signing Backup Checklist

- Key file location: `apps/mobile/release-signing/cmarket-release.keystore`
- Key alias: `cmarket-release`
- Certificate SHA-256 fingerprint: `bd7ab13b8b1be3f54fa1f5ebcfff58048a184f393c8a0515f123524f229882d5`
- Backup instructions: copy the key file and its separate local password record to an encrypted offline backup, verify the backup can be restored, restrict access to authorized maintainers, and never commit either item to Git.
