# brokentooth.io — historical deployed artifact

This **public repository contains a snapshot of built, static site files**. It is not the active design workspace, nor does it contain the full original React/Vite source.

## Actual serving arrangement (verified 2026-10-19)

- **Origin host:** Weakling, behind a Cloudflare Tunnel.
- **Web server:** Caddy, with an HTTP origin vhost configured in `/etc/caddy/Caddyfile`.
- **Static document root:** `/var/www/brokentooth`.
- **Live site:** the legacy VOID_CANVAS homepage, published /concepts/ pages, and /cat/.
- **This GitHub repository:** historical built-output source. The live directory was inspected and **is not a Git checkout**. It contains no `.git`. Therefore the previous instructions to run `git pull` in the webroot were incorrect and must not be followed.

## Deployment status

**There is no verified one-command deployment defined in this repository. Do not run `git pull` inside `/var/www/brokentooth`.** Live updates require an explicit approved release from the private source/studio workspace, a vetted static build, a safe staging + rollback plan, and validation of Caddy routes and browser output. A replacement release process has not yet been cut over.

The current public site is intentionally preserved while Sam's new creative direction is under review. Do not treat this artifact repository or the October 6 shell prototype as authorization to publish.

## Origin security notes

Caddy on Weakling was validated with appropriate privileges on 2026-10-19. Requests with the public Host header returned `404` for `/.git/config` and `/.env`, and `200` for the published concept route. TLS for the public domain terminates upstream at Cloudflare; the origin is plain HTTP. Backend authentication and actual remote HTTPS availability require separate checks; a URL path like `/admin` is not itself access control.

## Relationship to other work

- The legacy React/Vite application source has historically lived in `yourowndog/tooth`.
- Original four concepts, revised Worldbuild, current experimental unified shell, visual evidence, prompts and creative direction are consolidated in a **separate private studio repository**.
- A public artifact snapshot does not mean that all its data, copy, navigation or deployment assumptions are current.

The filenames in `assets/` are hashed build outputs. Do not edit those files to implement future design work.
