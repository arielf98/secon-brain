# Sken Brain for Obsidian

Private, local-first Obsidian plugin for a simple second brain:

- local vault remains the writing source of truth;
- Google Drive mirrors user files across desktop and mobile devices;
- desktop sync publishes the Sken Brain plugin bundle to `obsidian/plugins/sken-brain/` for mobile devices;
- conflicts are preserved under `_sync-conflicts/`;
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

Sync runs after startup when a device is already authorized, after local vault changes with a short debounce, and on the configured interval. **Sync Now** is also available as a command and settings button. Remote deletes never silently erase a locally edited file. A network/auth failure leaves the previous manifest baseline unchanged.

The normal vault sync excludes `.obsidian`, `.trash`, lock/temp files, plugin settings, tokens, and API keys. User Markdown, images, PDFs, and other attachments remain eligible. During a successful desktop sync, the local `manifest.json`, `main.js`, and `styles.css` are published to `obsidian/plugins/sken-brain/`. Mobile sync downloads those files into `.obsidian/plugins/sken-brain/`. Plugin settings and credentials are never synchronized. Reload Obsidian after a mobile plugin update.

## Git workflow

Local commits are allowed for checkpoints. Pushing is intentionally manual and is not performed by the agent.
