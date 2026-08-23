# Google Drive setup

The plugin keeps the Obsidian vault local. Google Drive is only a remote mirror. Each desktop or laptop authorizes its own Google account and stores its OAuth token in that device's plugin data; tokens are never written into the vault or synced.

## 1. Create a Google Cloud project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project for this private plugin.
3. In **APIs & Services → Library**, enable **Google Drive API**.
4. In **APIs & Services → OAuth consent screen**, configure the app for personal use. Add your Google account as a test user if Google asks for one.

## 2. Create the desktop OAuth client

1. Open **APIs & Services → Credentials**.
2. Choose **Create credentials → OAuth client ID**.
3. Select **Desktop app**.
4. Copy the client ID. The client secret is not placed in the vault.

The plugin uses the OAuth 2.0 authorization-code flow with PKCE and a loopback redirect on `127.0.0.1`. This is the native-app flow documented by Google: <https://developers.google.com/identity/protocols/oauth2/native-app>.

## 3. Configure the plugin

1. Install or copy the plugin into the vault's `.obsidian/plugins/second-brain/` directory.
2. Enable **Second Brain** in Obsidian.
3. Open its settings and paste the Google desktop client ID.
4. Select the Drive folder that will mirror this vault.
5. Choose **Authorize Google Drive** and complete the browser consent flow.

The Drive client lists non-trashed files below the selected folder, uploads new or locally changed files, and downloads remote-only changes. It does not delete remote files automatically. Conflicts are preserved under `_sync-conflicts/`.

## 4. Authorize another device

Repeat the client ID and authorization steps on every desktop or laptop. The local vault is the writing surface; Drive is the shared mirror. Keep sync paused while first configuring a new device, then run **Sync Now** after selecting the same Drive folder.

Google credentials and the OpenAI-compatible provider key (for example OpenAI or DeepSeek) are entered per device and are never saved in the vault or uploaded to Drive.

For Drive file listing and upload details, see Google's [files.list reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files) and [upload guide](https://developers.google.com/workspace/drive/api/guides/manage-uploads).
