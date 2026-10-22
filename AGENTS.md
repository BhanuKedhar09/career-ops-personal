# Career-Ops for Codex

Read `CLAUDE.md` for all project instructions, routing, and behavioral rules. They apply equally to Codex.

Key points:
- Reuse the existing modes, scripts, templates, and tracker flow — do not create parallel logic.
- Store user-specific customization in `config/profile.yml`, `modes/_profile.md`, or `article-digest.md` — never in `modes/_shared.md`.
- Never submit an application on the user's behalf.

For Codex-specific setup, see `docs/CODEX.md`.

## Cursor Cloud

Cloud Agent `install` puts Go 1.24.13 on `/usr/local/bin` (dashboard/go.mod requires Go 1.24; the image Go is 1.22), runs `npm install`, installs Playwright Chromium, and downloads the dashboard modules. `package-lock.json` is gitignored, so the install command is `npm install`.

Career-ops is a CLI plus the dashboard TUI. Useful checks:

- `npm run doctor` checks Node, Playwright, fonts, and the gitignored files `cv.md`, `config/profile.yml`, and `portals.yml`.
- `node test-all.mjs` is the full local suite. CI runs `node test-all.mjs --quick`, which skips the dashboard compile.
- `cd dashboard && go test ./...`, then `go build -o career-dashboard .` and `./career-dashboard --path ..`.
- `node generate-pdf.mjs input.html output.pdf` renders an ATS PDF with Playwright Chromium.
- `node scan.mjs --company Anthropic` needs `portals.yml` and an existing `data/pipeline.md` inbox with `## Pendientes` and `## Procesadas`. The scanner reads public Greenhouse, Ashby, and Lever APIs and appends matches to that inbox. Never submit an application.
