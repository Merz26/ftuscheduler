import fs from 'fs';

const pkgPath = './package.json';
const manifestPath = './manifest.json';

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const mode = process.argv[2] || 'patch'; // 'patch', 'minor', 'major'
const versionParts = (pkg.version || '1.1.0').split('.').map(Number);

if (mode === 'major') {
  versionParts[0] += 1;
  versionParts[1] = 0;
  versionParts[2] = 0;
} else if (mode === 'minor') {
  versionParts[1] += 1;
  versionParts[2] = 0;
} else {
  versionParts[2] += 1;
}

const newVersion = versionParts.join('.');
pkg.version = newVersion;
manifest.version = newVersion;

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// Sync popup.html badges
const popupHtmlPath = './extension/popup.html';
if (fs.existsSync(popupHtmlPath)) {
  let html = fs.readFileSync(popupHtmlPath, 'utf8');
  html = html.replace(/id="current_version_badge">v[\d.]+<\/span>/g, `id="current_version_badge">v${newVersion}</span>`);
  html = html.replace(/id="app_version_tag">v[\d.]+<\/span>/g, `id="app_version_tag">v${newVersion}</span>`);
  html = html.replace(/id="update_badge_version" class="update-version-badge">v[\d.]+<\/span>/g, `id="update_badge_version" class="update-version-badge">v${newVersion}</span>`);
  fs.writeFileSync(popupHtmlPath, html);
}

// Sync versionService.js fallback
const versionServicePath = './extension/versionService.js';
if (fs.existsSync(versionServicePath)) {
  let vs = fs.readFileSync(versionServicePath, 'utf8');
  vs = vs.replace(/return '[\d.]+';(\s*\n\s*\})/g, `return '${newVersion}';$1`);
  fs.writeFileSync(versionServicePath, vs);
}

// Sync mock Chrome APIs
for (const mockPath of ['./mockChromeApis.js', './extension/mockChromeApis.js']) {
  if (fs.existsSync(mockPath)) {
    let mock = fs.readFileSync(mockPath, 'utf8');
    mock = mock.replace(/version: '[\d.]+',/g, `version: '${newVersion}',`);
    fs.writeFileSync(mockPath, mock);
  }
}

console.log(`Bumped version (${mode}) to ${newVersion}`);
