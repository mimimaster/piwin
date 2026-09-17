# APNs (fill later)

Remote push is off until `~/.piwin/apns.json` has every field non-empty.
The `.p8` stays on disk; it is never committed and never logged.

1. Copy [apns.example.json](./apns.example.json) to `~/.piwin/apns.json` (already created empty).
2. Put the **Apple Push** key (not the App Store Connect notarization key unless it is the same Push key) at `~/.piwin/apns/AuthKey_<KEYID>.p8`.
3. Fill `keyId`, `teamId`, `bundleId`, `keyPath`. Use `sandbox` until TestFlight/App Store.

Do not paste the `.p8` into chat or git.
