#!/usr/bin/env node
/**
 * Install the coach Skill for Claude Code, which does not take uploads.
 *
 * Claude Code Skills are filesystem-based: a directory under ~/.claude/skills/
 * (personal, every project) or .claude/skills/ (this project only). There is no
 * zip and no upload step, and they do not sync with claude.ai — per the Agent
 * Skills docs, "Claude Code Skills are filesystem-based and separate from both
 * claude.ai and API."
 *
 * Personal is the right scope here: the coach is for talking about training and
 * food, which is not something you only do while inside this repo.
 *
 *   npm run skill:install          -> ~/.claude/skills/macromiser-coach/
 *   npm run skill:install -- here  -> .claude/skills/macromiser-coach/
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'skill');
const NAME = 'macromiser-coach';

const here = process.argv.includes('here');
const base = here ? join(ROOT, '.claude', 'skills') : join(homedir(), '.claude', 'skills');
const dest = join(base, NAME);

const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.md'));
if (!files.includes('SKILL.md')) throw new Error('skill/SKILL.md is missing.');

// Replace rather than merge: a file deleted from skill/ must not survive here,
// or the installed Skill drifts from the source exactly the way the hand-made
// zip did.
const replacing = existsSync(dest);
if (replacing) rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

for (const f of files) writeFileSync(join(dest, f), readFileSync(join(SRC_DIR, f)));

console.log(`${replacing ? 'Replaced' : 'Installed'} ${NAME} (${files.length} file${files.length === 1 ? '' : 's'})`);
console.log(`  ${dest}`);
for (const f of files) console.log(`    ${f}`);
console.log('');
console.log(here ? 'Scope: this project only.' : 'Scope: personal — available in every Claude Code project.');
console.log('Restart Claude Code, or start a new session, to pick it up.');
console.log('');
console.log('This does NOT affect claude.ai. Skills do not sync across surfaces —');
console.log('upload dist/macromiser-coach.zip there separately.');
