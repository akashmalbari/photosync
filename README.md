# Lantern Photos

Lantern Photos turns a folder on your Mac Mini into a private, comfortable photo library for every device on your home network. Your original files stay in that folder. The app only reads, renames, downloads, or moves them to a recoverable trash folder when you ask.

## What it does

- Browses JPG, PNG, WebP, GIF, AVIF, HEIC/HEIF, and TIFF files, including subfolders
- Creates fast browser-friendly previews without changing the originals
- Searches, sorts, opens, renames, and downloads photos
- Selects many photos for one ZIP download or bulk deletion
- Moves deleted photos to `.photo-vault-trash` instead of destroying them
- Fits phones, tablets, laptops, and desktops
- Can be protected with a shared password
- Runs entirely on your Mac Mini and local network
- Includes a native iPhone companion for resumable, differential photo sync

## Install on the Mac Mini

You need [Node.js 20 or newer](https://nodejs.org/) and Git.

```sh
git clone YOUR_REPOSITORY_URL lantern-photos
cd lantern-photos
npm install
npm run setup
npm run build
npm start
```

During setup, drag your photo folder from Finder into the Terminal window and press Return. Keep that folder outside this repository so app updates never touch it.

Open `http://localhost:4173` on the Mac Mini. From another device on the same network, open the home-network address printed when the app starts—usually something like `http://Your-Mac-Mini.local:4173`.

The first time it runs, macOS may ask whether Node can accept incoming network connections. Choose **Allow**. If the photo folder is in a protected macOS location, approve the requested Files and Folders access as well.

## Keep it running

After the setup and build steps, install the included login service:

```sh
npm run service:install
```

Lantern Photos will start automatically when that Mac user logs in and restart if it stops. To remove the service:

```sh
npm run service:remove
```

The Mac Mini must be awake for other devices to reach it. In **System Settings → Energy**, enable the option that prevents automatic sleeping when the display is off.

## Sync from an iPhone

Lantern includes a native iPhone companion because iOS does not let a website scan the complete Photos library. The companion asks for Full Photos Access and performs a differential sync only when you tap **Sync new photos**.

It compares stable Photos asset identifiers and edit timestamps with a hidden index on the Mac Mini. Unrecognized photos are fingerprinted before upload, so an identical file already in the exposed folder is indexed without transferring it again. Interrupted runs resume safely, and subsequent runs send only new or edited photos.

The iPhone project is at `ios/LanternSync/LanternSync.xcodeproj`. Follow [the iPhone installation guide](ios/README.md) to install it directly with Xcode.

Synced photos are organized under `iPhone Uploads/YYYY/MM` by default. To choose another subfolder, add this to `.env` before starting the server:

```ini
SYNC_FOLDER=From iPhone
```

When an iPhone edit creates a newer version of a previously synced asset, Lantern replaces the library copy and keeps the prior version in `.photo-vault-trash` for recovery. Removing a photo from the iPhone never removes the Mac copy.

## Add a password

Your home network is the boundary by default. To require a shared password, open `.env` and add:

```ini
LIBRARY_PASSWORD=replace-this-with-a-long-password
```

Restart Lantern Photos after changing `.env`. If you installed the login service, the easiest restart is:

```sh
npm run service:install
```

Do not expose port 4173 directly to the public internet. This version is designed for a trusted home network.

## Recover a deleted photo

Deleted files are moved into a hidden folder named `.photo-vault-trash` inside your chosen photo folder. On the Mac Mini, open that folder in Finder and press **Command–Shift–.** to show hidden items. Move any photo you want to restore back into the library.

## Update the app

Stop the foreground server if it is running, then:

```sh
git pull
npm install
npm run build
npm run service:install
```

Your photo folder is not stored in Git and is not affected by updates.

## Development

```sh
npm install
npm run dev
```

The interface runs at `http://localhost:5173` and the local API at `http://localhost:4173`. Run the full checks with `npm run check`.

## Project structure

- `src/App.jsx` — responsive photo-library interface
- `src/server/index.mjs` — local server and photo operations
- `src/server/library.mjs` — safe path and file-library helpers
- `scripts/setup.mjs` — one-time folder setup
- `scripts/service.mjs` — macOS background service helper
- `test/` — safety-focused automated tests

## Current boundaries

The first release manages image files only. The native companion does not yet transfer videos or the motion component of Live Photos. It also does not include face recognition, cloud backup, or a graphical Recently Deleted screen. The Git history is the intended place to grow those features safely.
