#!/usr/bin/env node

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// Opt-out for CI/containers that don't want skills copied anywhere.
if (process.env.SQL_CLIENT_SKIP_SKILLS) {
  console.log('[@civitas-cerebrum/sql-client] SQL_CLIENT_SKIP_SKILLS set — skipping skill install.');
  process.exit(0);
}

const packageDir = path.resolve(__dirname, '..');
const skillsDir  = path.join(packageDir, 'skills');

// Install scope, decided by how npm was invoked:
//   npm i -g  (npm_config_global === 'true')  -> ~/.claude/skills only
//   npm i     (local)                         -> <project>/.claude/skills only
// The project root is the consumer's root (INIT_CWD, else everything before the
// first node_modules segment of our own path). Nothing is written when that root
// has no package.json or sits inside npm's global prefix / lib dir.
// Skip when running in the package's own repo (local dev `npm install`).
if (!packageDir.includes('node_modules')) {
  process.exit(0);
}

const isGlobal = process.env.npm_config_global === 'true';

function underPath(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveProjectRoot() {
  if (process.env.INIT_CWD) return path.resolve(process.env.INIT_CWD);
  const nmIndex = packageDir.indexOf(`${path.sep}node_modules${path.sep}`);
  return nmIndex !== -1 ? packageDir.slice(0, nmIndex) : null;
}

function isNpmGlobalArea(dir) {
  const prefix = process.env.npm_config_prefix;
  if (prefix && (underPath(dir, path.join(prefix, 'lib')) || path.resolve(dir) === path.resolve(prefix))) return true;
  return path.basename(dir) === 'lib' && fs.existsSync(path.join(dir, 'node_modules'));
}

let destinations = [];
try {
  if (isGlobal) {
    destinations = [path.join(os.homedir(), '.claude', 'skills')];
  } else {
    const projectRoot = resolveProjectRoot();
    if (projectRoot && fs.existsSync(path.join(projectRoot, 'package.json')) && !isNpmGlobalArea(projectRoot)) {
      destinations = [path.join(projectRoot, '.claude', 'skills')];
    }
  }
} catch (err) {
  console.warn(`[@civitas-cerebrum/sql-client] Could not install Claude Code skill: ${err.message}`);
}
if (destinations.length === 0) {
  process.exit(0);
}

// Auto-discover every skill under skills/. A skill is any direct subdirectory
// that contains a SKILL.md at its root. New skill folders ship automatically
// on the next publish — no manifest edit required.
function discoverSkills(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => fs.existsSync(path.join(root, name, 'SKILL.md')));
}

// Recursively copy a skill directory, including any references/ tree the
// SKILL.md points at.
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src,  entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const skills = discoverSkills(skillsDir);

try {
  const installedSkills = new Set();

  for (const skillsDestBase of destinations) {
    for (const skill of skills) {
      const srcDir  = path.join(skillsDir, skill);
      const destDir = path.join(skillsDestBase, skill);

      copyDirRecursive(srcDir, destDir);
      installedSkills.add(skill);
    }
  }

  if (installedSkills.size > 0) {
    console.log(`[@civitas-cerebrum/sql-client] ✔ ${installedSkills.size} skill${installedSkills.size > 1 ? 's' : ''} installed to ${destinations[0]} — restart Claude Code to pick it up.`);
  } else {
    console.warn('[@civitas-cerebrum/sql-client] Skill files not found, skipping.');
  }
} catch (err) {
  console.warn(`[@civitas-cerebrum/sql-client] Could not install Claude Code skill: ${err.message}`);
}
