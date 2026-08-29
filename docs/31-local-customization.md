# Local Customization and Upgrades

This checkout is the OpenWA server repository (`openwa`), currently version
`0.23.2`. It is separate from the legacy `@open-wa/wa-automate` v4 and v5 alpha
projects. Keep those older checkouts isolated; do not copy their dependencies,
lockfiles, sessions, or generated browser profiles into this repository.

## Supported local toolchain

- Node.js 24 LTS
- npm 11 or newer
- Git for Windows
- Visual Studio 2022 Build Tools with the Desktop development with C++ workload
  and a current Windows SDK (needed by native Node.js dependencies)

Confirm the toolchain before installing:

```powershell
node --version
npm --version
git --version
```

## First local installation

From this repository root:

```powershell
npm ci
Copy-Item .env.minimal .env
New-Item -ItemType Directory -Force data, data\sessions
npm run dev
```

Open the dashboard at `http://localhost:2886`, the API at
`http://localhost:2785/api`, and Swagger at `http://localhost:2785/api/docs`.
The first install runs the repository's checked post-install patches for its
pinned WhatsApp dependencies. Do not replace `npm ci` with a global install.

Keep `.env`, `data/`, session credentials, QR images, API keys, and database
backups out of Git. Use a dedicated test WhatsApp number while developing.

## Branches that survive upstream upgrades

Keep `main` as a clean copy of the source repository and make local changes on
the customization branch:

```powershell
git switch codex/local-node24-windows
git switch -c feature/my-change
```

Commit one focused change at a time on feature branches, test it, and merge it
into `codex/local-node24-windows`. If you publish a personal GitHub fork, keep
the source repository as `upstream` and your fork as `origin`:

```powershell
git remote rename origin upstream
git remote add origin https://github.com/YOUR-NAME/OpenWA.git
git push -u origin codex/local-node24-windows
```

Replace `YOUR-NAME` with your GitHub account. Never push secrets or live session
data.

## Pulling future OpenWA upgrades

Back up `.env` and `data/` before every upgrade. Then update the clean branch
and replay the customization branch on top:

```powershell
git fetch upstream
git switch main
git pull --ff-only upstream main
git switch codex/local-node24-windows
git rebase main
npm ci
npm run check:versions
npx tsc --noEmit -p tsconfig.json
npm test -- --runInBand
npm run build:all
```

If the source remote is still named `origin`, use `origin` in the fetch and pull
commands instead. Resolve rebase conflicts carefully; do not overwrite `.env`,
`data/`, or session directories with versions from another checkout.

## Routine verification

Run these checks before keeping or deploying a customization:

```powershell
npm run test:scripts
npm run lint
npx tsc --noEmit -p tsconfig.json
npm test -- --runInBand
npm --prefix dashboard test -- --runInBand
npm run build:all
npm run check:audit
```

The root audit checker contains a narrow, documented temporary allowance for
the upstream Puppeteer `extract-zip` advisory, for which no patched dependency
version currently exists. Do not use `npm audit fix --force`; upgrade the pinned
WhatsApp/Puppeteer chain when a compatible fixed release becomes available.

## Running and stopping locally

Use `npm run dev` for API and dashboard hot reload. Use the production build for
a closer deployment smoke test:

```powershell
npm run build:all
npm run start:prod
```

Stop either command with `Ctrl+C`. A healthy API responds at
`http://localhost:2785/api/health/live`; readiness is available at
`http://localhost:2785/api/health/ready`.

## WhatsApp test safety

Pair only a dedicated development number. Start with one session, scan its QR
code from the phone's Linked devices screen, verify receive/send with a second
test number, and log out through OpenWA when finished. Browser automation and
unofficial WhatsApp clients can trigger account restrictions, so do not use a
business-critical or personal primary number for development.
