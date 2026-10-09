# site-qa

Browser testing for any website, set up with one command. It runs a page
audit plus your own Playwright tests, and every result is text or JSON, so
nobody has to judge a screenshot.

The audit loads every page at desktop size, phone size and in dark mode. It
checks for:

- page errors and JS errors
- broken links and failed requests
- accessibility (WCAG AA)
- pages that scroll sideways on a phone
- form fields too small for iOS

CI runs all of this on every push.

> **For Claude:** to add this to a project, clone this repo and run
> `node bin/site-qa.mjs init <project>`, then follow `plugin/skills/site-qa/SKILL.md`
> ("Set it up"). To update a project, run `node bin/site-qa.mjs update <project>`.

## Use it

**In any Claude Code session (cloud or local), with nothing installed:**

> set up site-qa from yitzhach/site-qa

Claude clones this repo and runs the installer. It then fixes the guesses in
`qa/site.config.ts` and records what the site already gets wrong, then commits.
From then on that project has a `/site-qa` command: type it, or just say
"test the site".

**On your own computer, once, to get `/site-qa` in every project:**

```
/plugin marketplace add yitzhach/site-qa
/plugin install site-qa@site-qa
```

In a project that doesn't have the kit yet, `/site-qa` sets it up first. The
plugin's command may show as `/site-qa:site-qa`.

**Update a project to the latest kit:** say "update site-qa", or run

```bash
git clone --depth 1 https://github.com/yitzhach/site-qa /tmp/site-qa
node /tmp/site-qa/bin/site-qa.mjs update .
```

Updates replace only the shared files and the site-qa block in `CLAUDE.md`.
A project's `qa/site.config.ts`, `qa/audit-baseline.json` and
`qa/tests/site/` are never touched.

## What `init` adds to a project

| Path | What it is |
|---|---|
| `qa/` | Playwright config, the audit, the reporter, `qa/browse`, pinned dependencies |
| `qa/site.config.ts` | How to start this site and which pages to audit. It's guessed for Vite, Next.js, `npm start` and static HTML, and every guess is marked `CHECK`. |
| `qa/tests/site/` | The project's own specs (starts with one example) |
| `qa/tests/views.spec.ts` | Opens every window, panel or tab listed under `views` in `site.config.ts` and audits each one. For apps that change what's on screen without changing the URL. |
| `.github/workflows/site-qa.yml` | CI on every push and PR; uploads traces on failure |
| `.claude/skills/site-qa/SKILL.md` | The same skill as the plugin, so `/site-qa` works in that project for anyone |

It also keeps `qa/**` out of the project's own tooling: a root
`tsconfig.json`, and Vitest or Jest (which would otherwise try to run the
Playwright specs). What it can't patch safely it prints as `CHECK`.

And it adds a **Site QA workflow** block to the project's `CLAUDE.md` (between
`site-qa:begin`/`end` markers; `update` refreshes it): work on a side branch,
report findings before changing site code, fix only what the owner approves,
keep both test suites green, and go live only on the owner's word, then
`npm --prefix qa run test:live` against `liveURL`.

## This repo

| Path | What it is |
|---|---|
| `kit/` | The shared files copied into every project's `qa/` |
| `templates/site-qa.yml` | The CI workflow |
| `bin/site-qa.mjs` | The installer (`init`, `update`). Plain Node, no dependencies. |
| `plugin/` | The Claude Code plugin; its one skill is `plugin/skills/site-qa/SKILL.md` |
| `.claude-plugin/marketplace.json` | Makes this repo installable with `/plugin marketplace add` |

Projects using it: [art-show-tracker](https://github.com/yitzhach/art-show-tracker).

`kit/` is TypeScript that Playwright runs directly, with no build step. Check
it with `cd kit && npm ci && npm run typecheck`.
