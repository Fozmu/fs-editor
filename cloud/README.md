# F.S. Editor cloud (accounts + video sync)

Lets people sign in inside the app, press **Sync** to put the open project and its media in the cloud, and open it on another PC from **Projects → Cloud**.

| Piece | Service | Why | Cost |
| --- | --- | --- | --- |
| Accounts (email + password, reset mails) | Supabase Auth | Ready-made, free up to 50,000 monthly users | $0 |
| Video / project storage | Cloudflare R2 | No download (egress) fees, which is what kills video storage bills elsewhere | First 10 GB free, then $0.015 per GB per month |
| API (`src/index.ts`) | Cloudflare Worker | Checks the sign-in token, hands out short-lived upload/download links, enforces a per-account cap | Free up to 100k requests/day |

Videos go straight between the PC and R2 through presigned links, so large files never pass through the Worker. Each account is capped at `QUOTA_GB` (default 50 GB) in `wrangler.toml`.

Storage layout in the bucket: `users/<user id>/projects/<project id>.json` and `users/<user id>/media/<media id>`.

## One-time setup

1. **Supabase** (supabase.com): create a free project. Under *Project Settings → API* copy the **Project URL** and the **anon / publishable key**. Email sign-in is on by default; to skip confirmation emails, turn off *Authentication → Sign In / Providers → Email → Confirm email*.
2. **Cloudflare** (dash.cloudflare.com), free account:
   - Open **R2** and enable it (asks for a card; nothing is charged under 10 GB).
   - *R2 → Manage API tokens → Create API token*, permission **Object Read & Write**. Copy the **Access Key ID** and **Secret Access Key**.
   - *My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template*. Copy the token.
   - Copy your **Account ID** (right side of the Workers & Pages overview).
3. **GitHub** repo → *Settings → Secrets and variables → Actions*:
   - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
   - Variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
4. Run the **Cloud API** workflow (Actions tab → Cloud API → Run workflow). It creates the bucket and deploys the Worker; the log prints its URL, like `https://fs-editor-cloud.<you>.workers.dev`.
5. Add that URL as repo variable `CLOUD_API_URL`. The next desktop build has the **Sign in** and **Sync** buttons.

Until all three variables exist, the app builds exactly as before, with no account UI.

## Local development

```bash
cd cloud && npm install
npx wrangler dev            # API on http://localhost:8787 (needs .dev.vars with the R2 secrets)
# in the repo root:
VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... VITE_CLOUD_API=http://localhost:8787 npm run dev
```

## Notes

- Sync is manual (the **Sync** button) and last-write-wins: syncing from one PC replaces the cloud copy of that project.
- Media already in the cloud isn't uploaded again; deleting a cloud project also deletes media no other cloud project uses.
- On desktop, downloaded media goes to `%APPDATA%/F.S. Editor/cloud-media/`. If the original file still exists at its old path (same PC), that's used instead.
- Single-file uploads are limited to 5 GB by R2's presigned PUT.
- The web build (not shipped) also works but needs a CORS rule on the bucket allowing `PUT`/`GET` from its origin.
