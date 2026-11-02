# AccrediHub

A self-hosted song database for radio presenters: artists, tracks, themes, tour dates, PR contacts, a playlist builder with show notes and live statistics, and optional Navidrome / Bandsintown / Ticketmaster integrations.

One container, one SQLite file, no external services. Everything lives in a single `/data` folder.

---

## Walkthrough: GitHub → Portainer on TrueNAS

You'll do three things: **(A)** put this code on GitHub, **(B)** let GitHub build the Docker image, **(C)** paste a short YAML into Portainer.

### Before you start
- Try the **demo** first: open `demo/index.html` in a browser (needs internet for fonts/Tailwind/Alpine). It's the real app running on sample data that stays in your browser. "Reset" (bottom-right) restores the samples.
- You need a free GitHub account and Portainer running on TrueNAS (SCALE: *Apps → Discover Apps → Portainer*).

### A. Put the code on GitHub
1. On github.com click **+ → New repository**. Name it `accredihub`. Leave it empty (no README/licence). **Public or Private both work.** Click *Create repository*.
2. On your computer, in the unzipped `accredihub` folder, run:
   ```bash
   git init -b main
   git add .
   git commit -m "AccrediHub"
   git remote add origin https://github.com/YOUR_GITHUB_USERNAME/accredihub.git
   git push -u origin main
   ```
   (No git? Use *GitHub Desktop*, or on the repo page choose *Add file → Upload files* and drag the contents of the folder in — include the hidden `.github` folder.)

### B. Let GitHub build the image
1. Open the repo's **Actions** tab. The workflow *Build and publish image* starts automatically on your push (first run takes ~3–6 minutes). Wait for the green tick.
   - If Actions asks you to enable workflows, click the green button.
   - If the run fails with a permissions error: *Settings → Actions → General → Workflow permissions → Read and write permissions → Save*, then *Re-run all jobs*.
2. Your image is now at `ghcr.io/YOUR_GITHUB_USERNAME/accredihub:latest` (username in **lowercase**).
3. **Make the image pullable.** Either:
   - **Easiest:** on GitHub open your profile → **Packages → accredihub → Package settings → Change visibility → Public**. Portainer can then pull it with no login. (The image contains no secrets — your data and passwords live in your TrueNAS folder and stack settings.)
   - **Or keep it private:** create a token at *GitHub → Settings → Developer settings → Personal access tokens (classic)* with only the `read:packages` scope. In Portainer go *Registries → Add registry → Custom registry*: URL `ghcr.io`, your GitHub username, the token as password. Then pick that registry when deploying.

### C. Deploy in Portainer
1. **Make a folder for your data** on TrueNAS: *Datasets → Add Dataset* e.g. `apps/accredihub` on your pool. The path will look like `/mnt/tank/apps/accredihub` (replace `tank` with your pool name).
2. In Portainer: **Stacks → Add stack**. Name it `accredihub`. Choose **Web editor**.
3. Paste the contents of `docker-compose.yml` (also in `deploy/portainer-stack.yml`) and change:
   | Setting | What to put |
   |---|---|
   | `image:` | `ghcr.io/your-github-username/accredihub:latest` (lowercase) |
   | `ADMIN_PASSWORD` | the password you'll log in with |
   | `SESSION_SECRET` | any long random text (keeps logins valid across restarts) |
   | volume path | your dataset path, e.g. `/mnt/tank/apps/accredihub:/data` |
   | port `3000:3000` | change the left number if 3000 is used by something else |
4. Click **Deploy the stack**. After ~20 seconds open `http://YOUR-TRUENAS-IP:3000`, log in as `admin` with your password.

### First steps in the app
- **Set up your profile:** click your name at the bottom of the left menu. Add a display name, photo and email, and change the password if you like.
- **Import your existing songs:** *Profile → Library tools → Import CSV* (columns `title, artist_name, album_name, album_art_url, release_date`). Duplicates are skipped.
- **Bulk upload / migrate a whole library:** *Profile → Library tools → Bulk upload*. Pick one or more files: a AccrediHub `.json` bundle (keys `artists`, `tracks` (with a `themes` list), `tour_dates`, `pr_agencies` (with `contacts`), `artist_pr`) or a `.csv` of any single kind (the type is detected from the header: `event_date` → tour dates, `title` → tracks, `company` → PR agencies, `agency` + `artist_name` → artist↔PR links, otherwise artists). Uploads are batched with progress, matched by name / artist+title / artist+date+venue, and safe to re-run. *Download bundle* exports everything in the same format. A small example lives in `samples/songregistry-sample.json`.
- **Navidrome:** fill in the three `NAVIDROME_*` lines in the stack, redeploy, then *Profile → Library tools → Sync Navidrome* (and *Backfill Art* to pull missing covers). It also re-syncs hourly by itself. Songs in Navidrome but not in AccrediHub appear greyed-out until you edit them.
- **Tour dates:** add a `BANDSINTOWN_APP_ID` and/or `TICKETMASTER_API_KEY`, redeploy, then *Tour Dates → Find new tour dates*.

---

## Updating
Push a change to `main` → GitHub rebuilds `:latest`. In Portainer: *Stacks → accredihub → Update the stack → tick "Re-pull image" → Update*. Your data is untouched; database upgrades run automatically at start-up.

## Backups
Everything is in the folder you mounted at `/data` (`accredihub.db` plus `uploads/`). Back up that dataset with a TrueNAS snapshot or replication task. (To copy by hand, stop the stack first so the database isn't mid-write.)

## Security notes
- Single admin account (name, photo and password editable on the Profile page; the username comes from `ADMIN_USERNAME`); logins are rate-limited (5 wrong tries → 10-minute block).
- Don't expose port 3000 straight to the internet. For remote access use a VPN/Tailscale, or put it behind a reverse proxy with HTTPS and set `COOKIE_SECURE: "true"`.
- If you don't set `ADMIN_PASSWORD`, one is generated and printed in the container log (also saved in `/data/.generated-admin-password`).

## Configuration reference
| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_USERNAME` | `admin` | login name |
| `ADMIN_PASSWORD` | generated | login password |
| `SESSION_SECRET` | generated | signs login cookies |
| `PORT` | `3000` | port inside the container |
| `DATA_DIR` | `/data` | database + uploads location |
| `RESET_ADMIN_PASSWORD` | – | `true` for one start-up: discard a password set on the Profile page and use `ADMIN_PASSWORD` again |
| `COOKIE_SECURE` | auto | `true` when served over https |
| `NAVIDROME_URL` / `_USERNAME` / `_PASSWORD` | – | Navidrome library sync |
| `BANDSINTOWN_APP_ID` | – | tour-date discovery |
| `TICKETMASTER_API_KEY` | – | tour-date discovery (GB events) |

## Run without Docker
Needs Node 22.13+. No `npm install` required.
```bash
ADMIN_PASSWORD=secret DATA_DIR=./data npm start
```

## Troubleshooting
- **Portainer: "denied" / "unauthorized" pulling the image** → package is still private (see B3) or the username isn't lowercase.
- **Container restarts in a loop** → check *Containers → accredihub → Logs*. Most often the data path doesn't exist; create the dataset first.
- **Can't log in after redeploy** → if you ever changed the password on the Profile page, that one is used and `ADMIN_PASSWORD` is ignored. To go back to the stack's password, add `RESET_ADMIN_PASSWORD: "true"` to the stack, redeploy once, then remove the line.
- **Browser "can't reach" page** → confirm the port mapping and use `http://` (not https) unless you've set up a proxy.
