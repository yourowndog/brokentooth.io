# brokentooth.io

Static website source for brokentooth.io.

## Architecture

- **GitHub is the source of truth**: `yourowndog/brokentooth.io` (`main`).
- **/var/www/brokentooth on Weakling is a deploy target**: a git checkout of
  `main` served by Caddy (`file_server`). The live directory is *not* edited
  in place; changes are made and committed elsewhere, pushed to GitHub, then
  pulled on Weakling.

> Decision (2026-10-05): the live directory is a **deploy target** (a checkout
> tracking `main`), not the working copy. The repo is **public** — the site
> itself is already public, and a public repo lets Weakling `git pull` with no
> stored credentials.

## Deploy

On Weakling:

    cd /var/www/brokentooth && git pull origin main

That is the entire deploy. No build step — the tree on `main` is what Caddy
serves.

## Note on content

The `assets/*.js` files carry Vite-style content hashed names, so this tree is
*built output*; the pre-build source (e.g. a Vite/Svelte project) is **not**
present on Weakling and is not yet in this repo. If a source project exists,
add it under a `src/` or separate repo; until then `main` tracks the deployed
artifact exactly as served.