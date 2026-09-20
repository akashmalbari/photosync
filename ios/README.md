# Lantern Sync for iPhone

Lantern Sync is the native companion to the Lantern Photos server. A sync starts only when you tap the button. The first run scans the complete iPhone photo library; later runs compare against the Mac Mini and process only new or edited assets.

## Before installing

On the Mac Mini, update and restart the server:

```sh
cd photosync
git pull
npm install
npm run build
npm start
```

Keep the Home network address that Lantern prints, such as `http://akashs-mac-mini.local:4173`.

## Install directly with Xcode

1. Install Xcode from the Mac App Store and open it once to finish setup.
2. Connect the iPhone to the Mac with a cable, unlock it, and choose **Trust** if prompted.
3. Open `ios/LanternSync/LanternSync.xcodeproj` in Xcode.
4. Select the blue **LanternSync** project, select the **LanternSync** target, and open **Signing & Capabilities**.
5. Choose your Apple ID under **Team**. Change the bundle identifier if Xcode says it is unavailable.
6. Choose your iPhone from the device menu at the top of Xcode.
7. Press the Run button.

The iPhone may ask you to enable **Developer Mode** under **Settings → Privacy & Security** and restart. Xcode will guide you through that step.

A free Apple ID can install the app for personal testing, but the development signature generally expires after seven days and must be renewed through Xcode. An Apple Developer Program membership supports longer-lived installs and TestFlight distribution.

## First launch

1. Open Lantern Sync on the iPhone.
2. Tap **Connect** and enter the full Home network address, including `http://` and port `4173`.
3. Enter the same library password if `LIBRARY_PASSWORD` is enabled on the Mac Mini.
4. Approve **Local Network** access.
5. Approve **Full Photos Access**. Limited access cannot provide a complete differential sync.
6. Tap **Sync new photos**.

For a large first library, connect both devices to power, keep the iPhone on the same Wi-Fi, and leave Lantern Sync open. The app prevents auto-lock while a sync is active. You can pause at any time; the next run compares against the completed Mac-side index and resumes the remainder.

## How differential sync works

- The Mac stores a private `.lantern-sync-index.json` file inside the exposed photo folder.
- The index records an opaque iPhone device ID, each Photos asset ID, its edit version, content fingerprint, and Mac path.
- Files already present are detected by SHA-256 fingerprint and are not uploaded again.
- New originals are stored beneath `iPhone Uploads/YYYY/MM`.
- Edited assets replace their prior synced copy; the old copy moves to `.photo-vault-trash`.
- Deleting from the iPhone never deletes from the Mac.

The sync index and Photos identifiers stay on the Mac Mini. Photo bytes travel directly over the local network and never pass through a Lantern cloud service.
