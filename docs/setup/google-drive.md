# Google Drive sync setup

Sken Brain uses Google Drive as a shared mirror for one local Obsidian vault across desktop, Android, and iOS. It does not require an Obsidian Sync subscription.

The included Cloudflare Worker only completes Google OAuth token exchange and refresh. It has no database, stores no Google token, and never receives vault files. After authorization, the plugin communicates directly with the Google Drive API.

## 1. Deploy the free sync Worker

Create or sign in to a Cloudflare account, then deploy the Worker from this repository:

```bash
cd worker
npx wrangler deploy
```

Copy the resulting `https://sken-brain-sync.<account>.workers.dev` URL. The first deployment can report configuration errors until the secrets below are added.

## 2. Configure Google OAuth

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and enable **Google Drive API**.
3. Configure the OAuth consent screen for personal use. Add your Google account as a test user when the app is in testing mode.
4. Create an OAuth client with application type **Web application**.
5. Add this exact authorized redirect URI, replacing the hostname with your Worker URL:

```text
https://sken-brain-sync.<account>.workers.dev/oauth/callback
```

Copy the client ID and client secret.

## 3. Add Worker secrets

From the `worker` directory, run:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put STATE_SECRET
```

Paste the corresponding Google values for the first two prompts. For `STATE_SECRET`, use a new random value such as the output of:

```bash
openssl rand -hex 32
```

Verify that the service responds after the secrets are configured:

```text
https://sken-brain-sync.<account>.workers.dev/health
```

The response should be `{"status":"ok"}`.

## 4. Select the shared Drive folder

Create one folder in Google Drive for the vault mirror and copy its folder ID. In a Drive URL such as:

```text
https://drive.google.com/drive/folders/FOLDER_ID
```

the value after `/folders/` is the folder ID.

## 5. Configure each Obsidian device

Install and enable Sken Brain once on each desktop or mobile device. Then open **Settings → Sken Brain** and enter:

- **Sync service URL:** the Worker URL without `/oauth/callback`;
- **Drive folder ID:** the same folder ID on every device.

Choose **Authorize Google Drive**, complete consent in the system browser, and follow the link back to Obsidian. Each device authorizes separately and keeps its token locally.

Keep sync paused while connecting a new device if its local vault already contains files. Review the vault first, then resume and choose **Sync Now**.

## Sync and privacy behavior

The plugin synchronizes normal vault files, including Markdown, images, PDFs, and other attachments. It excludes `.obsidian`, `.trash`, temporary files, plugin code, settings, OAuth tokens, and AI API keys.

The existing three-way sync logic preserves concurrent edits under `_sync-conflicts/`. Network or authorization failures do not advance the local manifest baseline.
