# Multi-Line Hero

Multiplayer-first browser arena survival game built with Vite, TypeScript, canvas rendering, DOM HUD components, and a Bun TypeScript server.

## Specs

The source-of-truth specs live in `specs/`:

- `specs/SPEC.md`: product goals, runtime architecture, server ownership, multiplayer/economy boundaries, UX direction, WebSocket protocol, and development process.
- `specs/MECHANICS_SPEC.md`: arena simulation, movement, targeting, attack telegraphs, projectiles, collision resolution, damage sources, and local defeat reset.
- `specs/PROGRESSION_SPEC.md`: permanent XP, attributes, derived stats, item generation, equipment, skills, generated enemy builds, drops, wave composition, and rival scaling.

Update the relevant spec before changing behavior.

## Tooling

Use Bun for project tooling and scripts.

- `bun run dev`: start the Vite client dev server.
- `bun run server`: start the Bun server.
- `bun run build`: typecheck and build the client.
- `bun test`: run deterministic domain, server-service, protocol, and WebSocket integration tests.

## Production releases

Production is promoted from `main` to the dedicated `production` branch every Friday at 17:00 UTC by `.github/workflows/weekly-release.yml`. Railway must be configured to deploy only that branch. Ordinary pushes to `main` therefore accumulate without restarting the production server; the scheduled workflow deploys the latest validated commit once each week. Maintainers can use the workflow's manual dispatch when an urgent patch cannot wait for the next window.

The workflow runs `bun run release-production`, which refuses a dirty checkout, a branch other than `main`, or a local commit that differs from `origin/main`. Promoting a commit that is already on `production` succeeds without creating another deployment.

To run only the local client against the production server, open [http://localhost:3000/?prod](http://localhost:3000/?prod). The longer `?server=pvp.up.railway.app` form remains available for explicit endpoint overrides.

### View pending requests

`bun run features` fetches pending player-submitted feature requests from the public production API and prints them as JSON. Pass an API base URL as the first argument to query another deployment, for example `bun run features http://localhost:3000`.

With `jq`, `fzf`, and GNU `base64` installed, use the following command to search request titles and preview the selected request's full description and vote totals:

```bash
bun run features |
  jq -r '.[] | [.title, (. | @base64)] | @tsv' |
  fzf \
    --delimiter=$'\t' \
    --with-nth=1 \
    --preview-window='right:60%:wrap' \
    --preview "printf '%s' {2} | base64 -d | jq -r '\"\(.title)\n\n\(.description)\n\nScore: \(.score)  ↑\(.upvotes)  ↓\(.downvotes)\nScheduled: \(.scheduledMonth)\"'"
```

### Run a feature agent

`bun run feature-agent <harness>` launches an autonomous implementation workflow with `codex`, `claude`, `pi`, or `opencode`. The default `bun feature` runs `pi` with the qwen model through ollama. It requires a clean worktree and an interactive terminal, randomly selects an incomplete feature, prints the request and any security warnings, then starts the AI harness without another confirmation prompt. The harness is instructed to implement, validate, commit, and push the selected request. Only after the launcher confirms a new commit, a clean worktree, and that HEAD matches its configured upstream does it mark the request `Done with AI` through the public completion API.

```bash
bun feature
bun run feature-agent codex
bun run feature-agent claude
bun run feature-agent opencode
```

## Architecture

- `common/` contains runtime protocol schemas and pure balance, content, combat, inventory, progression, item, random, and wave rules.
- `server/GameService.ts` is the application layer over a replaceable player repository; `server/createApp.ts` owns HTTP/WebSocket transport.
- `src/game/ArenaState.ts` and `src/game/systems/` own local simulation state and fixed-step systems. `src/game/render/` owns canvas presentation.
- `src/platform/`, `src/net/`, and `src/ui/` isolate browser persistence, transport, and stable DOM views from simulation rules.

The server is authoritative for issued enemies, rewards, generated drops, progression, and inventory mutations. Client reports contain opaque unit or drop IDs and are runtime-validated before dispatch.

## Balance profiles

Local and production runs use the same authoritative combat, wave, reward, and progression balance.

Player progression and inventory are persisted through Bun SQL. Local development defaults to the git-ignored `server-data/players.sqlite`; production sets `DATABASE_URL` to a PostgreSQL connection string.
