# Sken Brain for Obsidian

Private, local-first Obsidian plugin for a simple second brain:

- local vault remains the writing source of truth;
- Google Drive mirrors user files across desktop and mobile devices;
- desktop sync publishes the Sken Brain plugin bundle to `obsidian/plugins/sken-brain/` for mobile devices;
- conflicts use latest-modified-file-wins: the newer local file replaces the Drive copy, while the newer Drive file replaces the local copy;
- Related Notes are scored locally from note context, tags, links, folder, and recency;
- Ask Vault, Explain relation, Summarize, Extract structure, and Create note use bounded local context;
- OpenAI and DeepSeek use an OpenAI-compatible provider interface;
- AI writes always produce a preview and require **Apply**.

## Development

```bash
npm install
npm test
npm run build
```

The build produces `main.js`. Copy `manifest.json`, `main.js`, and `styles.css` into:

```text
<vault>/.obsidian/plugins/sken-brain/
```

Reload Obsidian and enable **Sken Brain**.

## Configure cross-platform sync

Follow [docs/setup/google-drive.md](docs/setup/google-drive.md) to deploy the included stateless Cloudflare Worker, create a Google OAuth Web client, choose one Drive folder, and authorize each device. Obsidian Sync is not required. OAuth tokens remain in each device's plugin data and are never written into the vault or stored by the Worker.

## Configure AI

In **Settings → Sken Brain**, select OpenAI or DeepSeek and enter the provider's API key and model. `Base URL` is optional for an OpenAI-compatible endpoint. Keys are stored per device and are never uploaded to Drive.

## Sync behavior

Sync is manual-only: use the ribbon icon, **Sync Now** command, or settings button. Editing, deleting, or renaming a vault file does not call the sync API. When both sides edit the same file, the latest modified version wins. Delete-vs-edit cases remain conflicts because deletion time is not recorded. A network/auth failure leaves the previous manifest baseline unchanged.

The normal vault sync excludes `.obsidian`, `.trash`, lock/temp files, plugin settings, tokens, and API keys. User Markdown, images, PDFs, and other attachments remain eligible. During a successful desktop sync, the local `manifest.json`, `main.js`, and `styles.css` are published to `obsidian/plugins/sken-brain/`. Mobile sync downloads those files into `.obsidian/plugins/sken-brain/`. Plugin settings and credentials are never synchronized. Reload Obsidian after a mobile plugin update.

## Git workflow

Local commits are allowed for checkpoints. Pushing is intentionally manual and is not performed by the agent.
