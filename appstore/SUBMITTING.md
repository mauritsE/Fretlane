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
| Privacy policy, support and terms pages (linked from the listing) | `wiki/`, published to the GitHub wiki by `.github/workflows/wiki.yml` |
| Screenshots, 2880×1800 | `appstore/screenshots/` |

What only you can do: pay Apple, create the certificates, sort out the paid-app paperwork
(step 6), press "Submit". Roughly an hour of clicking plus Apple's review (typically 1–3 days).

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

## 6. Set up the paid app (price, agreement, tax, bank, trader status)

The App Store version costs **€4.99** (one-time, no in-app purchases). The source code and the
GitHub downloads stay free; store buyers pay for a signed app that installs and updates in one
click, without the "can't verify the developer" warning the GitHub build shows.

1. **Paid Apps agreement.** App Store Connect → *Business* → accept the **Paid Apps** agreement.
   Apple won't let you set a price until it's active.
2. **Tax and banking.** On the same page, add your bank account (IBAN) and fill in the tax forms.
   As a Dutch resident you fill in the US *W-8BEN* form (it confirms you're not a US taxpayer, so no
   US tax is withheld). Apple collects and pays the EU VAT on each sale; the income itself goes on
   your Dutch tax return.
3. **Small Business Program.** Apply at
   <https://developer.apple.com/app-store/small-business-program/>. It lowers Apple's commission
   from 30% to 15%. It isn't automatic. At €4.99 that leaves roughly €3.50 per sale after VAT and
   commission.
4. **Trader status (EU Digital Services Act).** App Store Connect asks whether you are a trader.
   Selling a paid app means yes. Apple then shows your **address, phone number and email** on the
   product page in the EU. As an individual that's your home address unless you use a business
   address (e.g. a KvK-registered *eenmanszaak* with a separate address). Decide this before you
   submit.
5. **Price.** The app → *Pricing and Availability* → base country **Netherlands**, price **€4.99**.
   Apple fills in the other countries. Raising the price later is easy; lowering it after people
   paid more annoys early buyers, so start low.

## 7. Create an App Store Connect API key (for the upload)

Users and Access → Integrations → App Store Connect API → **+**, access *App Manager*. Note the
**Key ID** and **Issuer ID**, and download the `.p8` file (only possible once).

## 8. Add the GitHub secrets

GitHub → repository → Settings → Secrets and variables → Actions → *New repository secret*.
Base64-encode files first, on a Mac: `base64 -i file | pbcopy`, then paste.

| Secret | Value |
| --- | --- |
| `MAS_CERTIFICATES_P12` | base64 of `fretlane-mas.p12` |
| `MAS_CERTIFICATES_PASSWORD` | the password you chose in step 3 |
| `MAS_SIGNING_NAME` | your name and team ID exactly as in the certificate, e.g. `Maurits Elzinga (AB12CD34EF)` (Keychain shows it as "Apple Distribution: Maurits Elzinga (AB12CD34EF)") |
| `MAS_PROVISIONING_PROFILE` | base64 of the `.provisionprofile` from step 4 |
| `APP_STORE_CONNECT_KEY_ID` | Key ID from step 7 |
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID from step 7 |
| `APP_STORE_CONNECT_KEY_P8` | base64 of the `.p8` file |

## 9. Build and upload

GitHub → Actions → **Mac App Store** → *Run workflow* → tick **Upload** → Run.

1. `sandbox` launches the app inside the App Sandbox (no secrets needed).
2. `store` builds a universal (Apple chip + Intel) installer, checks its signature, validates it
   with Apple and uploads it. The build number is the workflow run number, so every upload is
   higher than the previous one, as Apple requires.

After about 15 minutes the build appears in App Store Connect under the version's **Build** section.

## 10. Submit for review

Select the build, answer the export-compliance questions and fill in *App Review Information*
(contact details, sign-in not required, and the review notes). The exact answers and text are in
`appstore/LISTING.md` sections 7 and 8.

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
