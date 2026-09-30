# Putting Fretlane on the Mac App Store

Fretlane is a desktop app (Electron), so its Apple store is the **Mac App Store**. An iPhone/iPad
version would be a separate port (see the end of this page).

The repository already contains everything that can be prepared without an Apple account:

| Done in the repo | Where |
| --- | --- |
| App Store build settings (sandbox, entitlements, installer) | `package.json` → `build.mas`, `build/entitlements.mas*.plist` |
| CI that builds the App Store flavour and launches it **inside the App Sandbox** | `.github/workflows/app-store.yml`, job `sandbox` |
| CI that signs the installer and uploads it to App Store Connect | same workflow, job `store` |
| Listing text, keywords, privacy answers | `appstore/LISTING.md` |
| Privacy policy (linked from the listing) | `appstore/PRIVACY.md` |
| Screenshots, 2880×1800 | `appstore/screenshots/` |

What only you can do: pay Apple, create the certificates, press "Submit". Roughly an hour of
clicking plus Apple's review (typically 1–3 days).

## 1. Join the Apple Developer Program (once, €99/year)

<https://developer.apple.com/programs/enroll/>. As an individual, the store shows your own name as
the seller. Approval can take a day or two.

## 2. Register the app ID

[Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list)
→ Identifiers → **+** → App IDs → App.

- Description: `Fretlane`
- Bundle ID (explicit): `app.fretlane` (must match `appId` in package.json)
- No extra capabilities needed.

## 3. Create the two certificates

You need a Mac for this step (Keychain Access). In **Certificates → +** create:

1. **Apple Distribution** (signs the app)
2. **Mac Installer Distribution** (signs the .pkg you upload)

For each: Keychain Access → Certificate Assistant → *Request a Certificate From a Certificate
Authority* → save to disk → upload the request → download the certificate → double-click it.

Then in Keychain Access → *My Certificates*, select **both** certificates, right-click → *Export 2
items…* → save as `fretlane-mas.p12` with a password.

## 4. Create the provisioning profile

Profiles → **+** → *Mac App Store Connect* (under Distribution) → App ID `app.fretlane` → the
Apple Distribution certificate → name it `Fretlane App Store` → download `….provisionprofile`.

## 5. Create the app in App Store Connect

[App Store Connect](https://appstoreconnect.apple.com/apps) → **+** → New App: platform macOS,
name **Fretlane** (if taken, e.g. "Fretlane Tab Player"), bundle ID `app.fretlane`, SKU `fretlane`.
Fill in the fields from `appstore/LISTING.md` and upload the screenshots.

## 6. Create an App Store Connect API key (for the upload)

Users and Access → Integrations → App Store Connect API → **+**, access *App Manager*. Note the
**Key ID** and **Issuer ID**, and download the `.p8` file (only possible once).

## 7. Add the GitHub secrets

GitHub → repository → Settings → Secrets and variables → Actions → *New repository secret*.
Base64-encode files first, on a Mac: `base64 -i file | pbcopy`, then paste.

| Secret | Value |
| --- | --- |
| `MAS_CERTIFICATES_P12` | base64 of `fretlane-mas.p12` |
| `MAS_CERTIFICATES_PASSWORD` | the password you chose in step 3 |
| `MAS_SIGNING_NAME` | your name and team ID exactly as in the certificate, e.g. `Maurits Elzinga (AB12CD34EF)` (Keychain shows it as "Apple Distribution: Maurits Elzinga (AB12CD34EF)") |
| `MAS_PROVISIONING_PROFILE` | base64 of the `.provisionprofile` from step 4 |
| `APP_STORE_CONNECT_KEY_ID` | Key ID from step 6 |
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID from step 6 |
| `APP_STORE_CONNECT_KEY_P8` | base64 of the `.p8` file |

## 8. Build and upload

GitHub → Actions → **Mac App Store** → *Run workflow* → tick **Upload** → Run.

1. `sandbox` launches the app inside the App Sandbox (no secrets needed).
2. `store` builds a universal (Apple chip + Intel) installer, checks its signature, validates it
   with Apple and uploads it. The build number is the workflow run number, so every upload is
   higher than the previous one, as Apple requires.

After about 15 minutes the build appears in App Store Connect under the version's **Build** section.

## 9. Submit for review

Select the build, answer the export-compliance question (**No**: Fretlane uses only standard HTTPS),
and in *App Review Information* paste:

> Fretlane is a guitar tab player. Open any song in the library and press Play (or Space); the
> built-in synthesizer plays it and the cursor follows the tab. Press M for the metronome. The
> ☆ on a card adds a favorite and ✓ moves a song to the archive (see the tabs at the top).
> Songs can optionally be linked to a YouTube video, which plays in YouTube's official embedded
> player. No login is needed.

Then **Add for Review → Submit**.

## If review pushes back

- *Guideline 5.2 (intellectual property):* the bundled songs are public-domain melodies in original
  arrangements (see `songbook/songs.ts`). Fretlane bundles no third-party tabs, and YouTube videos
  play only through the official embed.
- *Guideline 2.4.5 (Mac apps):* the app is sandboxed and does not update itself or install
  anything outside its container.

## An iPhone / iPad version?

That's a bigger job and not part of this build: iOS doesn't allow the local Node server Fretlane
uses. The UI (TypeScript + alphaTab) could be reused in a Capacitor app with the library moved into
the browser's storage. That's roughly one to two weeks of work, and worth doing only if the Mac
version finds users.
