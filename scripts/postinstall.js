#!/usr/bin/env node

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const packageDir = path.resolve(__dirname, '..');
const skillsDir  = path.join(packageDir, 'skills');

// When installed as a dependency, __dirname is:
//   <project>/node_modules/@civitas-cerebrum/wasapi/scripts
// so four levels up reaches the consumer's project root.
const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');

// Skip when running in the package's own repo (local dev `npm install`) —
// otherwise we'd recursively install our own skills back over themselves.
if (!packageDir.includes('node_modules')) {
  process.exit(0);
}

// Install to both project-level and user-level .claude/skills/ directories.
// Project-level keeps the right version pinned to the consumer's repo.
// User-level overwrites stale skills from older installs so the latest copy
// always wins regardless of which project Claude Code opened most recently.
const homeDir = os.homedir();
const destinations = [
  path.join(projectRoot, '.claude', 'skills'),
  path.join(homeDir, '.claude', 'skills'),
];

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
    console.log(`[@civitas-cerebrum/wasapi] ✔ ${installedSkills.size} skill${installedSkills.size > 1 ? 's' : ''} installed to ${destinations.length} locations — restart Claude Code to pick it up.`);
  } else {
    console.warn('[@civitas-cerebrum/wasapi] Skill files not found, skipping.');
  }
} catch (err) {
  console.warn(`[@civitas-cerebrum/wasapi] Could not install Claude Code skill: ${err.message}`);
}
