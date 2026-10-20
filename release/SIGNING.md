# Signing the Mac app (no more "Open Anyway")

macOS only opens a downloaded app without the System Settings → Privacy & Security → **Open Anyway** step when the app is **signed with a Developer ID** and **notarised** by Apple. The Release workflow (`.github/workflows/release.yml`, job `macos`) does both as soon as the secrets below exist. Until then it keeps building the ad-hoc signed app, as before.

All of this needs the **Apple Developer Program** (€99/year, enrol as an individual at <https://developer.apple.com/programs/enroll/>). The same membership also covers the Mac App Store build (`appstore/SUBMITTING.md`).

## 1. The Developer ID certificate (on your Mac)

1. Open **Keychain Access** → menu **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority**. Enter your email and name, choose **Saved to disk**, and save the `.certSigningRequest` file.
2. Go to <https://developer.apple.com/account/resources/certificates/add>. Choose **Developer ID Application** (only the account holder can), use the **G2 Sub-CA**, upload the request file and download the certificate.
3. Double-click the downloaded `.cer` to add it to Keychain Access.
4. In Keychain Access → **My Certificates**, find **Developer ID Application: Your Name (TEAMID)**. Right-click → **Export…** → format **.p12**, and set a password.
5. In Terminal, copy the file as text: `base64 -i ~/Desktop/Certificates.p12 | pbcopy`

## 2. The notarisation key (App Store Connect API)

1. Go to <https://appstoreconnect.apple.com/access/integrations/api> → **Team Keys** → **+**. Name it "Fretlane notarisation" and give it the **Developer** role.
2. Download the `.p8` file. You can only download it once.
3. Note the **Key ID** (next to the key) and the **Issuer ID** (above the list).

## 3. GitHub secrets

In <https://github.com/mauritsE/Fretlane/settings/secrets/actions> add:

| Secret | Value |
| --- | --- |
| `MAC_DEVELOPER_ID_P12` | the base64 text from step 1.5 |
| `MAC_DEVELOPER_ID_PASSWORD` | the .p12 password from step 1.4 |
| `APPLE_API_KEY_P8` | the whole contents of the `.p8` file, including the BEGIN and END lines |
| `APPLE_API_KEY_ID` | the Key ID |
| `APPLE_API_ISSUER` | the Issuer ID |

## 4. Release

Run the Release workflow as usual. In the `macos` job, "Put the Developer ID certificate in a keychain" imports the certificate and reads its name from it ("Signing as: …"), and "Build, sign with Developer ID and notarise" replaces the ad-hoc build. If the app can't be signed, the build stops instead of quietly shipping an unsigned app. Notarisation usually takes a few minutes. The verification step then checks that Gatekeeper accepts both apps and both disk images as **Notarized Developer ID**. If that check fails, nothing is published.

After the first signed release, remove the "Open Anyway" instructions from `release/RELEASE_NOTES.md` and from the website's download page (`src/routes/download.tsx` in mauritsE/fretlane-sync-magic).

## Windows

Windows shows a different warning: SmartScreen's "Windows protected your PC" → **More info → Run anyway**. Removing it needs a Windows code-signing certificate, which is a separate purchase from Apple's and isn't set up here.
