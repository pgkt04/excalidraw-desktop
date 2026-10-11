const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'https://github.com/excalidraw/excalidraw.git';
const COMMIT = 'e65eca999e071503efb893d3379a29fb96ff37c4';
const YARN = 'yarn@1.22.22';
// The upstream build points fonts at this CDN first; the bundle must not need the network.
const FONTS_CDN = 'https://excalidraw.nyc3.cdn.digitaloceanspaces.com/oss/';

const root = path.join(__dirname, '..');
const srcDir = path.join(root, '.excalidraw-src');
const outDir = path.join(root, 'app-bundle');
const stampPath = path.join(outDir, '.commit');

function run(cmd, args, cwd) {
  execFileSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, HUSKY: '0' },
  });
}

function readStamp() {
  try {
    return fs.readFileSync(stampPath, 'utf8').trim();
  } catch {
    return null;
  }
}

function checkoutPinnedCommit() {
  if (!fs.existsSync(path.join(srcDir, '.git'))) {
    fs.mkdirSync(srcDir, { recursive: true });
    run('git', ['init', '-q'], srcDir);
    run('git', ['remote', 'add', 'origin', REPO], srcDir);
  }
  run('git', ['fetch', '-q', '--depth', '1', 'origin', COMMIT], srcDir);
  run('git', ['checkout', '-q', '--force', COMMIT], srcDir);
}

function localizeFontUrls(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      localizeFontUrls(file);
    } else if (/\.(html|css|js)$/.test(entry.name)) {
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes(FONTS_CDN)) fs.writeFileSync(file, text.replaceAll(FONTS_CDN, '/'));
    }
  }
}

if (readStamp() === COMMIT) {
  console.log(`app-bundle is already at ${COMMIT}`);
  process.exit(0);
}

checkoutPinnedCommit();
run('npx', ['--yes', YARN, 'install', '--frozen-lockfile'], srcDir);
run('npx', ['--yes', YARN, 'build:app:docker'], srcDir);

fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync(path.join(srcDir, 'excalidraw-app', 'build'), outDir, {
  recursive: true,
  filter: (src) => !src.endsWith('.map'),
});
// The upstream build loads the UI font only from the CDN, so it does not emit these files.
fs.cpSync(path.join(srcDir, 'packages', 'excalidraw', 'fonts', 'Assistant'), path.join(outDir, 'fonts', 'Assistant'), {
  recursive: true,
});
fs.copyFileSync(path.join(srcDir, 'LICENSE'), path.join(outDir, 'LICENSE'));
localizeFontUrls(outDir);
fs.writeFileSync(stampPath, `${COMMIT}\n`);
console.log(`app-bundle built from ${COMMIT}`);
