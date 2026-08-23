# Second Brain for Obsidian

Private, local-first Obsidian plugin for a simple second brain:

- local vault remains the writing source of truth;
- Google Drive mirrors user files across desktop/laptop devices;
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
<vault>/.obsidian/plugins/second-brain/
```

Reload Obsidian and enable **Second Brain**.

## Configure Google Drive

Follow [docs/setup/google-drive.md](docs/setup/google-drive.md) to create a Google Cloud desktop OAuth client, enable Drive API, choose a folder, and authorize each device. The OAuth token is stored in that device's plugin data and never inside the vault.

## Configure AI

In **Settings → Second Brain**, select OpenAI or DeepSeek and enter the provider's API key and model. `Base URL` is optional for an OpenAI-compatible endpoint. Keys are stored per device and are never uploaded to Drive.

## Sync behavior

Sync runs after startup when a device is already authorized, after local vault changes with a short debounce, and on the configured interval. **Sync Now** is also available as a command and settings button. Remote deletes never silently erase a locally edited file. A network/auth failure leaves the previous manifest baseline unchanged.

The plugin excludes `.obsidian`, `.trash`, lock/temp files, plugin settings, tokens, and API keys from Drive sync. User Markdown, images, PDFs, and other attachments remain eligible.

## Git workflow

Local commits are allowed for checkpoints. Pushing is intentionally manual and is not performed by the agent.
