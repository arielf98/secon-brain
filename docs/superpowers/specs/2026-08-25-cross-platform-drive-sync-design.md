# Cross-Platform Google Drive Sync Design

**Date:** 2026-08-25
**Status:** Approved in conversation
**Scope:** Personal desktop and mobile vault sync without Obsidian Sync

## Goal

Sken Brain synchronizes normal vault files between Obsidian desktop and mobile through one Google Drive folder. The plugin remains local-first: files are edited locally, Google Drive is the remote mirror, and same-file conflicts are resolved by latest modified time.

## Architecture

The existing sync engine handles user-file changes and deletion propagation, while a small Cloudflare Worker replaces the desktop-only loopback OAuth flow for every platform. A separate plugin updater publishes the desktop Sken Brain bundle and downloads it on mobile from `obsidian/plugins/sken-brain/`.

1. The plugin opens the Worker's `/oauth/start` URL with a random device state.
2. The Worker redirects to Google using a Web application OAuth client and a fixed HTTPS callback.
3. The Worker verifies its signed state and returns the short-lived Google authorization code through `obsidian://sken-brain-auth`.
4. The plugin verifies its device state and sends the code to `/oauth/exchange`.
5. The Worker adds the Google client secret, exchanges the code, and returns the access and refresh tokens without storing them.
6. Tokens remain in device-local Obsidian plugin data. Refreshes pass through `/oauth/refresh`; Drive file traffic continues directly between the plugin and Google Drive.

The Worker is stateless and needs no database, KV namespace, or paid Obsidian service.

## Sync scope

Sync includes Markdown, images, PDFs, and other user vault files. `.obsidian`, `.trash`, plugin settings, OAuth tokens, API keys, locks, and temporary files remain excluded from normal vault sync. The plugin updater separately publishes or downloads only `manifest.json`, `main.js`, and `styles.css` between `obsidian/plugins/sken-brain/` and the local `.obsidian/plugins/sken-brain/` folder.

Each device uses the same Drive folder ID but keeps its own OAuth token, sync manifest, and device ID. The existing three-way planner handles upload, download, deletion propagation, offline recovery, and latest-modified-file conflict resolution. Delete-vs-edit cases remain conflicts because deletion time is not recorded.

## Platform behavior

Desktop and mobile use the same browser-based authorization flow and the same Worker URL. The plugin contains no top-level Node.js or Electron imports, and `manifest.json` declares `isDesktopOnly: false`.

Authorization is user-triggered from settings. Background sync never opens a browser. After a successful `obsidian://` callback, the plugin saves the token and immediately runs sync.

## Security

- Google client ID and client secret are Cloudflare Worker secrets.
- Worker state is HMAC-signed and expires after ten minutes.
- Plugin state is random, stored locally before opening the browser, and checked on callback.
- Google authorization codes are short-lived and single-use.
- The Worker does not persist Google tokens or proxy vault files.
- Error responses never include Google secrets or token response bodies.

## Failure handling

Missing Worker URL or Drive folder ID produces a configuration message without opening a browser. Invalid, expired, or mismatched OAuth state is rejected. Token refresh failure changes sync status to `Auth required`; the user can explicitly authorize again. Existing sync behavior preserves the manifest baseline on network or Drive failures.

## Deployment

The repository contains a Worker entrypoint and `wrangler.toml`. The user creates a Google OAuth Web application, registers `<worker-url>/oauth/callback`, sets three Worker secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `STATE_SECRET`), deploys the Worker, and enters its URL plus the shared Drive folder ID on each device.

## Acceptance criteria

- The plugin builds without Electron or Node.js runtime imports.
- Obsidian can install it on desktop, Android, and iOS.
- Desktop and mobile can authorize through the same Worker.
- Both platforms can upload and download files through the existing Drive sync engine.
- `.obsidian` settings and credentials are never synchronized; only the three allowlisted Sken Brain bundle files are downloaded from the dedicated plugin path.
- Worker route tests, auth client tests, the existing sync tests, typecheck, and production build pass.
