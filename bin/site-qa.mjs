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
   overwrites them.
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
  'tests/audit.spec.ts',
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

  // CHECK: every page worth auditing, relative to baseURL. Pages the site
  // links to but this list misses show up as unlistedPages in results.
  pages: [${pages}],

  // Freeze the page's clock if anything on it depends on today's date.
  // fixedTime: '2026-01-15T12:00:00',

  // Every other host is blocked during tests, so no result depends on the
  // network. Add a host here only if the page cannot work without it.
  allowHosts: [],

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
  say(`site-qa added to ${ROOT}`);
  say(`  site looks like: ${g.kind}  (serve: ${g.command})`);
  say(`  pages: ${g.pages.join(', ')}`);
  if (ts) say(`  ${ts}`);
  say('\nNext:');
  say('  1. Check qa/site.config.ts (the lines marked CHECK).');
  say('  2. npm ci --prefix qa');
  say('  3. npm --prefix qa run audit:baseline   # records what the site already gets wrong');
  say('  4. npm --prefix qa test                 # should pass');
  say('  5. Commit qa/, .github/workflows/site-qa.yml and .claude/skills/site-qa/.');
} else if (cmd === 'update') {
  if (!fs.existsSync(path.join(QA, 'site.config.ts'))) {
    say(`No ${rel(QA)}/site.config.ts: this project does not have site-qa yet. Use "init".`);
    process.exit(1);
  }
  const changed = copyShared();
  const ts = excludeFromRootTsconfig();
  say(changed.length ? `Updated:\n${changed.map(c => '  ' + c).join('\n')}` : 'Already up to date.');
  if (ts) say(`  ${ts}`);
  if (changed.some(c => c.endsWith('package-lock.json'))) say('\nDependencies changed: run npm ci --prefix qa.');
  say('Then npm --prefix qa test, and commit.');
} else {
  say('usage: node bin/site-qa.mjs init|update [project-dir]');
  process.exit(cmd ? 1 : 0);
}
