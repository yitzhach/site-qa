#!/usr/bin/env node
/* ==========================================================================
   site-qa installer. Plain Node, no dependencies.

     node bin/site-qa.mjs init   [project]   add qa/ to a project (default: cwd)
     node bin/site-qa.mjs update [project]   refresh the shared files

   What a project owns and update never touches:
     qa/site.config.ts      how to start the site, which pages, what to accept
     qa/audit-baseline.json known issues
     qa/tests/site/         the project's own specs
   Everything else in qa/, the workflow and the skill are shared, and update
   overwrites them. Both also keep qa/ out of a root tsconfig, Vitest and
   Jest, and keep the site-qa block in CLAUDE.md current.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, target = '.'] = process.argv.slice(2);
const ROOT = path.resolve(target);
const QA = path.join(ROOT, 'qa');

const SHARED = [  // kit/<file> → qa/<file>
  'package.json', 'package-lock.json', 'playwright.config.ts', 'tsconfig.json',
  '.gitignore', 'browse', 'README.md',
  'lib/audit.ts', 'lib/baseline.ts', 'lib/reporter.ts', 'lib/site.ts', 'lib/test.ts',
  'tests/audit.spec.ts', 'tests/views.spec.ts',
];
const EXTRA = [  // repo file → project file
  ['templates/site-qa.yml', '.github/workflows/site-qa.yml'],
  ['plugin/skills/site-qa/SKILL.md', '.claude/skills/site-qa/SKILL.md'],
];

const say = (s = '') => console.log(s);
const rel = (p) => path.relative(ROOT, p) || '.';
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);

function copy(from, to) {
  const next = fs.readFileSync(from);
  const prev = read(to);
  if (prev && prev.equals(next)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, next);
  if (path.basename(to) === 'browse') fs.chmodSync(to, 0o755);
  return true;
}

function copyShared() {
  const changed = [];
  for (const f of SHARED) if (copy(path.join(HERE, 'kit', f), path.join(QA, f))) changed.push(rel(path.join(QA, f)));
  for (const [from, to] of EXTRA) if (copy(path.join(HERE, from), path.join(ROOT, to))) changed.push(to);
  let commit = null;
  try { commit = execSync('git rev-parse --short HEAD', { cwd: HERE, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  fs.writeFileSync(path.join(QA, '.site-qa.json'), JSON.stringify({
    source: 'https://github.com/yitzhach/site-qa', commit, at: new Date().toISOString(),
  }, null, 2) + '\n');
  return changed;
}

/* A first guess at how to start the site. Every guess is marked CHECK. */
function guessSite() {
  const pkg = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); } catch { return null; } })();
  const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
  const install = '([ -d node_modules ] || npm ci)';  // a fresh clone (CI, cloud session) has none
  if (deps.vite) return {
    kind: 'Vite',
    command: `${install} && npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort`,
    cwd: '..', baseURL: 'http://127.0.0.1:4173/', pages: ['./'],
  };
  if (deps.next) return {
    kind: 'Next.js',
    command: `${install} && npm run build && npx next start -H 127.0.0.1 -p 3000`,
    cwd: '..', baseURL: 'http://127.0.0.1:3000/', pages: ['./'],
  };
  if (pkg?.scripts?.start) return {
    kind: 'a Node app (npm start)',
    command: `${install} && npm start`, cwd: '..', baseURL: 'http://127.0.0.1:3000/', pages: ['./'],
    note: 'CHECK: the port npm start listens on',
  };
  // Static files: the folder with an index.html nearest the root.
  const dirs = ['', ...fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory() && !/^(\.|node_modules$|qa$|dist$|build$)/.test(d.name)).map(d => d.name)];
  const dir = dirs.find(d => fs.existsSync(path.join(ROOT, d, 'index.html'))) ?? '';
  const pages = fs.existsSync(path.join(ROOT, dir))
    ? fs.readdirSync(path.join(ROOT, dir)).filter(f => /\.html?$/.test(f)).sort((a, b) =>
        (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)))
    : [];
  return {
    kind: 'static files', command: 'python3 -m http.server 8765 --bind 127.0.0.1', cwd: '..',
    baseURL: `http://127.0.0.1:8765/${dir ? dir + '/' : ''}`, pages: pages.length ? pages : ['./'],
  };
}

function writeSiteConfig(g) {
  const pages = g.pages.map(p => `'${p}'`).join(', ');
  fs.writeFileSync(path.join(QA, 'site.config.ts'), `/* ==========================================================================
   What the audit needs to know about THIS site. Everything else in qa/ is
   shared (yitzhach/site-qa); this file, audit-baseline.json and tests/site/
   belong to this project, and \`site-qa update\` never touches them.
   ========================================================================== */
import type { SiteConfig } from './lib/site';

const config: SiteConfig = {
  // CHECK: guessed for ${g.kind}. Runs from qa/; cwd '..' is the repo root.
  serve: {
    command: ${JSON.stringify(g.command)},
    cwd: ${JSON.stringify(g.cwd)},
    readyURL: ${JSON.stringify(g.baseURL)},
  },
  baseURL: ${JSON.stringify(g.baseURL)},${g.note ? `  // ${g.note}` : ''}

  // CHECK: where the site is deployed; \`npm --prefix qa run test:live\`
  // audits it there after a change goes live.
  // liveURL: 'https://example.com/',

  // CHECK: every page worth auditing, relative to baseURL. Pages the site
  // links to but this list misses show up as unlistedPages in results.
  pages: [${pages}],

  // Freeze the page's clock if anything on it depends on today's date.
  // fixedTime: '2026-01-15T12:00:00',

  // Every other host is blocked during tests, so no result depends on the
  // network. Add a host here only if the page cannot work without it.
  allowHosts: [],

  // An app that opens windows, panels or tabs without changing the URL:
  // name the buttons that open them, and tests/views.spec.ts opens and
  // audits each one. Leave it out for a site of plain pages.
  // views: {
  //   openWith: 'nav.dock',                  // where those buttons live
  //   names: ['Projects', 'Calendar'],       // their accessible names
  //   scope: '.window[data-focused="true"]', // the view once open
  //   settled: '.window',                    // something the app opens itself
  //   known: { 'Calendar a11y:label': 'Known bug, not fixed yet' },
  // },

  // Findings that are the site working as designed, each with the reason:
  // { page: 'x.html', finding: 'network:404 data.json', why: '…' }
  accept: [],
};

export default config;
`);
}

function writeExampleSpec() {
  const f = path.join(QA, 'tests', 'site', 'pages.spec.ts');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `/* This project's own specs live in this folder. This one is an example: every
   page has a title. Locate by role and name, as a user would:
   page.getByRole('button', { name: 'Menu' }). */
import { test, expect } from '../../lib/test';
import { site } from '../../lib/site';

test.skip(() => test.info().project.name !== test.info().config.projects[0].name,
  'markup: one project is enough');

for (const pagePath of site.pages) {
  test(\`\${pagePath} has a title\`, async ({ page }) => {
    await page.goto(pagePath);
    await expect(page).toHaveTitle(/\\S/);
  });
}
`);
}

/* A root tsconfig.json whose include matches qa/*.ts would type-check the kit
   without its dependencies and break that project's build. */
function excludeFromRootTsconfig() {
  const f = path.join(ROOT, 'tsconfig.json');
  if (!fs.existsSync(f)) return null;
  const s = fs.readFileSync(f, 'utf8');
  if (/"qa(\/\*\*)?"/.test(s)) return null;
  if (/"exclude"\s*:\s*\[/.test(s)) {
    fs.writeFileSync(f, s.replace(/("exclude"\s*:\s*\[)(\s*)/, '$1$2"qa/**", '));
    return 'added "qa/**" to tsconfig.json\'s exclude';
  }
  if (/"compilerOptions"\s*:/.test(s)) {
    fs.writeFileSync(f, s.replace(/\{/, '{\n  "exclude": ["node_modules", "qa/**"],'));
    return 'added "exclude": ["node_modules", "qa/**"] to tsconfig.json';
  }
  return 'CHECK: tsconfig.json — exclude "qa/**" from it by hand';
}

/* Vitest and Jest match *.spec.ts anywhere, qa/ included, and fail on
   Playwright specs: keep them out of qa/. */
function excludeFromUnitRunners() {
  const pkg = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); } catch { return null; } })();
  const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
  const notes = [];
  if (deps.vitest) {
    const f = ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'vitest.config.mjs',
      'vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']
      .map(n => path.join(ROOT, n)).find(n => fs.existsSync(n) && /\btest\s*:\s*\{/.test(fs.readFileSync(n, 'utf8')));
    const s = f && fs.readFileSync(f, 'utf8');
    if (s && s.includes("'qa/**'")) { /* done already */ }
    else if (s && (s.match(/\btest\s*:\s*\{/g) || []).length === 1 && !/\bexclude\s*:/.test(s.slice(s.search(/\btest\s*:\s*\{/)))) {
      let next = s.replace(/(\btest\s*:\s*\{)/, "$1\n    // qa/ is Playwright (site-qa): npm --prefix qa test, not Vitest.\n    exclude: [...configDefaults.exclude, 'qa/**'],");
      if (!/\bconfigDefaults\b.*from 'vitest\/config'/.test(next)) next = `import { configDefaults } from 'vitest/config';\n` + next;
      fs.writeFileSync(f, next);
      notes.push(`added exclude 'qa/**' to ${path.basename(f)}'s test block (Vitest)`);
    } else {
      notes.push("CHECK: Vitest — add exclude: [...configDefaults.exclude, 'qa/**'] to its test config by hand");
    }
  }
  if (deps.jest) {
    const j = pkg.jest;
    if (j && JSON.stringify(j.testPathIgnorePatterns || []).includes('/qa/')) { /* done already */ }
    else if (j && typeof j === 'object' && !fs.readdirSync(ROOT).some(n => /^jest\.config\./.test(n))) {
      j.testPathIgnorePatterns = [...(j.testPathIgnorePatterns || ['/node_modules/']), '/qa/'];
      fs.writeFileSync(path.join(ROOT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
      notes.push("added '/qa/' to package.json jest.testPathIgnorePatterns");
    } else {
      notes.push("CHECK: Jest — add '/qa/' to testPathIgnorePatterns by hand");
    }
  }
  return notes;
}

/* The way of working that comes with site-qa, kept between markers in the
   project's CLAUDE.md so update can refresh it. A project that wrote its own
   section before markers existed keeps it untouched. */
const BEGIN = '<!-- site-qa:begin (yitzhach/site-qa writes this block; update refreshes it) -->';
const END = '<!-- site-qa:end -->';
function claudeMdBlock() {
  return `${BEGIN}
## Site QA workflow (the default for every change)

\`qa/\` is site-qa (yitzhach/site-qa): a browser audit plus this project's
specs, at desktop size, phone size and in dark mode. Known issues sit in
\`qa/audit-baseline.json\` (and \`views.known\` in \`qa/site.config.ts\`); only
new ones fail.

1. Work on a side branch, never straight on the branch that deploys.
2. Test a local build: \`npm --prefix qa test\` builds, serves and audits it.
3. Report findings in plain words first; change no app code until the owner
   approves which fixes.
4. Fix in small batches; after each, the project's own tests and
   \`npm --prefix qa test\` must both pass.
5. Anything near saved data: also check against existing data, with a
   second tab open.
6. Land on the deploying branch only on the owner's word; then audit the
   live site: \`npm --prefix qa run test:live\` (\`liveURL\` in site.config.ts).
   A cloud session needs that host under Allowed domains in the
   environment's network settings; until then say the live check is blocked.

Tedious sweeps (triage, reading long results) may go to a Haiku subagent;
decisions and code stay in the main session.

- \`npm ci --prefix qa && npm --prefix qa test\` — browser tests → \`qa/results/audit.json\`
- \`qa/browse open <url>\` — read and drive a page as text
- \`npm --prefix qa run audit:baseline\` — re-record known issues (should only shrink)
${END}
`;
}
function writeClaudeMd() {
  const f = path.join(ROOT, 'CLAUDE.md');
  const s = read(f)?.toString() ?? '';
  const block = claudeMdBlock();
  const a = s.indexOf(BEGIN), b = s.indexOf(END);
  if (a >= 0 && b > a) {
    const next = s.slice(0, a) + block.trimEnd() + s.slice(b + END.length);
    if (next === s) return null;
    fs.writeFileSync(f, next);
    return 'refreshed the site-qa block in CLAUDE.md';
  }
  if (/^## Site QA workflow/m.test(s)) return 'CLAUDE.md has its own "Site QA workflow" section: left as it is';
  fs.writeFileSync(f, (s ? s.replace(/\n*$/, '\n\n') : '# CLAUDE.md\n\n') + block);
  return s ? 'added the site-qa workflow to CLAUDE.md' : 'created CLAUDE.md with the site-qa workflow';
}

if (cmd === 'init') {
  if (fs.existsSync(path.join(QA, 'site.config.ts'))) {
    say(`${rel(QA)}/site.config.ts already exists: this project has site-qa. Use "update".`);
    process.exit(1);
  }
  if (fs.existsSync(QA) && fs.readdirSync(QA).length) {
    say(`${rel(QA)}/ exists and is not site-qa. Move it aside first; nothing was changed.`);
    process.exit(1);
  }
  const g = guessSite();
  fs.mkdirSync(QA, { recursive: true });
  copyShared();
  writeSiteConfig(g);
  writeExampleSpec();
  const ts = excludeFromRootTsconfig();
  const notes = [ts, ...excludeFromUnitRunners(), writeClaudeMd()].filter(Boolean);
  say(`site-qa added to ${ROOT}`);
  say(`  site looks like: ${g.kind}  (serve: ${g.command})`);
  say(`  pages: ${g.pages.join(', ')}`);
  for (const n of notes) say(`  ${n}`);
  say('\nNext:');
  say('  1. Check qa/site.config.ts (the lines marked CHECK): serve, pages, liveURL, views.');
  say('  2. npm ci --prefix qa');
  say('  3. npm --prefix qa run audit:baseline   # records what the site already gets wrong');
  say('  4. npm --prefix qa test                 # should pass');
  say('  5. Commit qa/, .github/workflows/site-qa.yml, .claude/skills/site-qa/ and CLAUDE.md.');
} else if (cmd === 'update') {
  if (!fs.existsSync(path.join(QA, 'site.config.ts'))) {
    say(`No ${rel(QA)}/site.config.ts: this project does not have site-qa yet. Use "init".`);
    process.exit(1);
  }
  const changed = copyShared();
  const notes = [excludeFromRootTsconfig(), ...excludeFromUnitRunners(), writeClaudeMd()].filter(Boolean);
  say(changed.length || notes.some(n => !n.startsWith('CLAUDE.md has')) ? `Updated:\n${changed.map(c => '  ' + c).join('\n')}` : 'Already up to date.');
  for (const n of notes) say(`  ${n}`);
  if (changed.some(c => c.endsWith('package-lock.json'))) say('\nDependencies changed: run npm ci --prefix qa.');
  say('Then npm --prefix qa test, and commit.');
} else {
  say('usage: node bin/site-qa.mjs init|update [project-dir]');
  process.exit(cmd ? 1 : 0);
}
