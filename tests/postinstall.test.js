const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');

function setup({ withPackageJson = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlc-pi-'));
  const home = path.join(base, 'home');
  const project = path.join(base, 'project');
  const pkg = path.join(project, 'node_modules', '@civitas-cerebrum', 'sql-client');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(pkg, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(pkg, 'skills', 'sql-client'), { recursive: true });
  fs.copyFileSync(path.join(repo, 'scripts', 'postinstall.js'), path.join(pkg, 'scripts', 'postinstall.js'));
  fs.writeFileSync(path.join(pkg, 'skills', 'sql-client', 'SKILL.md'), '# skill');
  if (withPackageJson) fs.writeFileSync(path.join(project, 'package.json'), '{}');
  return { base, home, project, script: path.join(pkg, 'scripts', 'postinstall.js') };
}

function run(env, extra = {}) {
  const clean = { PATH: process.env.PATH };
  return spawnSync(process.execPath, [env.script], {
    env: { ...clean, HOME: env.home, USERPROFILE: env.home, INIT_CWD: env.project, ...extra },
    encoding: 'utf8',
  });
}

const has = (...p) => fs.existsSync(path.join(...p));

test('global install writes ~/.claude only', () => {
  const e = setup();
  const r = run(e, { npm_config_global: 'true', npm_config_prefix: path.join(e.base, 'prefix') });
  assert.equal(r.status, 0);
  assert.ok(has(e.home, '.claude', 'skills', 'sql-client', 'SKILL.md'));
  assert.ok(!has(e.project, '.claude'));
  assert.ok(!has(e.base, 'prefix'));
});

test('local install writes <project>/.claude only', () => {
  const e = setup();
  const r = run(e, { npm_config_global: 'false' });
  assert.equal(r.status, 0);
  assert.ok(has(e.project, '.claude', 'skills', 'sql-client', 'SKILL.md'));
  assert.ok(!has(e.home, '.claude'));
});

test('root without package.json writes nothing', () => {
  const e = setup({ withPackageJson: false });
  const r = run(e, { npm_config_global: 'false' });
  assert.equal(r.status, 0);
  assert.ok(!has(e.project, '.claude'));
  assert.ok(!has(e.home, '.claude'));
});

test('root inside npm global prefix lib writes nothing', () => {
  const e = setup();
  const lib = path.join(e.base, 'lib');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'package.json'), '{}');
  const r = run(e, { npm_config_global: 'false', npm_config_prefix: e.base, INIT_CWD: lib });
  assert.equal(r.status, 0);
  assert.ok(!has(lib, '.claude'));
  assert.ok(!has(e.home, '.claude'));
});

test('SQL_CLIENT_SKIP_SKILLS=1 skips both modes', () => {
  const e = setup();
  assert.equal(run(e, { npm_config_global: 'true', SQL_CLIENT_SKIP_SKILLS: '1' }).status, 0);
  assert.equal(run(e, { npm_config_global: 'false', SQL_CLIENT_SKIP_SKILLS: '1' }).status, 0);
  assert.ok(!has(e.home, '.claude'));
  assert.ok(!has(e.project, '.claude'));
});

test('copy failure warns and exits 0', () => {
  const e = setup();
  fs.writeFileSync(path.join(e.project, '.claude'), 'a file, not a dir');
  const r = run(e, { npm_config_global: 'false' });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /Could not install/);
});
