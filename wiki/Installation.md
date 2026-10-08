# Installation

Fretlane is a normal desktop app. You don't need Node.js or anything else.

## Download

Get the latest version from the [Releases page](https://github.com/mauritsE/Fretlane/releases).

| Your computer | Download | Then |
| --- | --- | --- |
| **Windows** 10 / 11 | `Fretlane-…-windows-setup.exe` | Double-click it. Fretlane installs and opens, with a shortcut on your desktop and in the Start menu. |
| **Mac** with Apple chip (M1, M2, M3, M4…) | `Fretlane-…-mac-arm64.zip` | Double-click the zip, then drag **Fretlane** into your **Applications** folder. |
| **Mac** with Intel chip | `Fretlane-…-mac-x64.zip` | Same as above. |
| **Linux** | `Fretlane-…-linux-x86_64.AppImage` | Right-click → Properties → allow executing as a program, then double-click it. |

Not sure which Mac you have? Apple menu → **About This Mac**. "Chip: Apple M…" means Apple chip; "Processor: Intel" means Intel.

On a Mac you can also buy Fretlane on the **Mac App Store**. It's the same app, signed by Apple, so it installs and updates in one click without the warning below. Buying it supports development; the GitHub downloads stay free.

## Opening it the first time

The GitHub downloads aren't registered with Apple or Microsoft, so the first time you open Fretlane your computer asks whether you trust it. You only have to do this once.

- **Mac:** open Fretlane. When macOS says it can't verify the app, click **Done**. Then go to **System Settings → Privacy & Security**, scroll down to "Fretlane was blocked", click **Open Anyway** and confirm. On older macOS versions, right-click Fretlane → **Open** → **Open**.
- **Windows:** if a blue "Windows protected your PC" box appears, click **More info** → **Run anyway**.
- **Linux:** no prompt; just make sure the AppImage is allowed to run as a program.

## Where your songs are stored

Your library is a **Fretlane** folder in your home folder. Open it with **File → Show Songs Folder**. (The Mac App Store version keeps it inside the app's own sandbox folder.)

- Updating to a newer version keeps your library.
- To back up your songs, copy that folder. To move them to another computer, copy it to the same place there.
- Coming from **Songstarr** (the app's old name)? Your library is moved over automatically the first time you open Fretlane.

## Updating

Download the newest version from the Releases page and install it over the old one, the same way as the first time. The Mac App Store version updates through the App Store.

## Uninstalling

- **Windows:** Settings → Apps → Fretlane → Uninstall.
- **Mac:** drag Fretlane from Applications to the Bin.
- **Linux:** delete the AppImage.

Uninstalling leaves your **Fretlane** songs folder alone. Delete it yourself if you also want to remove your library.

## Running from source (for developers)

Requires Node.js 20 or newer.

```bash
git clone https://github.com/mauritsE/Fretlane.git
cd Fretlane
npm install
npm run dev        # UI on http://localhost:5173
```

See the [README](https://github.com/mauritsE/Fretlane#readme) for configuration and development commands.
