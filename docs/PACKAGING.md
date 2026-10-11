# Quest app (Horizon Store) packaging

Optional: the competition only needs the URL. The APK is a thin wrapper (a Trusted
Web Activity) around the live site, so web fixes ship by `npm run deploy`, never by
rebuilding the APK.

Already done in the repo:

- `public/manifest.webmanifest` and `public/icons/*` (regenerate with `node scripts/icons.mjs`)
- `index.html` links the manifest and icon
- `src/index.ts` starts the AR session on launch, only inside the installed app
- `twa/twa-manifest.json`: package `com.fourkinc.deskcompanion`, mode `immersive`, Quest on

## 1. One-time setup (interactive, in your own terminal)

```sh
npm i -g @meta-quest/bubblewrap-cli
bubblewrap doctor        # accept the JDK 17 and Android SDK installs and licence
```

## 2. Signing key (permanent: back it up)

The package name and key can never change for a published app. Confirm
`com.fourkinc.deskcompanion` first, then:

```sh
KT=$(find ~/.bubblewrap/jdk -path '*/bin/keytool' | head -1)
"$KT" -genkeypair -v -keystore twa/android.keystore -alias android -keyalg RSA \
  -keysize 2048 -validity 10000 -dname "CN=Desk Companion, O=4KInc, C=US"
"$KT" -list -v -keystore twa/android.keystore -alias android | grep -i SHA256
```

Set `signingKey.path` in `twa/twa-manifest.json` to the keystore's absolute path.
`twa/*.keystore` is git-ignored and excluded from the Docker image.

## 3. Build

```sh
cd twa
export BUBBLEWRAP_KEYSTORE_PASSWORD=... BUBBLEWRAP_KEY_PASSWORD=...
bubblewrap update && bubblewrap build     # -> app-release-signed.apk
```

## 4. Asset links (the app will not launch without this)

Create `public/.well-known/assetlinks.json` with the SHA-256 from step 2, then
`npm run deploy` and check `curl -s https://desk-companion-1031148889398.us-central1.run.app/.well-known/assetlinks.json`.

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.fourkinc.deskcompanion",
    "sha256_cert_fingerprints": ["AA:BB:..."]
  }
}]
```

## 5. Store upload

Create the app in the Meta Horizon developer dashboard, put its numeric App ID in
`applicationId`, rebuild, then:

```sh
./ovr-platform-util upload-quest-build --app-id <APP_ID> --app-secret <SECRET> \
  --apk twa/app-release-signed.apk --channel ALPHA --age-group MIXED_AGES --notes "First build"
```

The first upload may ask an org admin to accept the Developer Distribution Agreement.

## Mode note

`immersive` opens straight into mixed reality with the sample day and the buddy's
greeting. The 2D page extras (pasting a calendar link, Copy on drafts) stay on the
browser URL. If the installed app should show the 2D page first instead, set
`horizonOSAppMode` to `"2D"`, remove the auto-enter block in `src/index.ts`, and rebuild.
