#!/usr/bin/env node
/**
 * Pack skill/ into dist/macromiser-coach.zip, ready to upload to claude.ai as
 * a Claude Skill.
 *
 * Emits TWO artifacts, because the surfaces differ:
 *
 *   dist/macromiser-coach.zip         two files, spec-correct progressive
 *                                     disclosure. For claude.ai with code
 *                                     execution on, and for the API.
 *   dist/macromiser-coach-single.zip  REFERENCE.md inlined as an appendix.
 *                                     For any surface where Claude cannot read
 *                                     a Level-3 file from the filesystem — on
 *                                     claude.ai that needs code execution
 *                                     enabled, and if it is off the split file
 *                                     is simply never opened.
 *
 * Claude Code needs NEITHER: skills there are directories on disk under
 * ~/.claude/skills/ or .claude/skills/, with no upload step at all. Run
 * `npm run skill:install` for that.
 *
 * Packs EVERY .md in skill/, not just SKILL.md. Claude Skills support
 * supporting files loaded on demand, which is how REFERENCE.md keeps the
 * per-tool semantics out of the always-injected prompt. A packer that shipped
 * only SKILL.md would leave every cross-reference to it dangling.
 *
 * This exists because the zip was previously "produced by hand" (ROADMAP,
 * Phase 2) and drifted badly: by 2026-08-24 the uploaded artifact was 91 lines
 * behind and contained no rules for events, pace, personal records,
 * prescriptions or programs — every feature shipped that day. A deployed tool
 * the Skill never mentions is a tool the model will not call, so a stale zip
 * silently undoes a deploy.
 *
 * Dependency-free on purpose, like scripts/check-recipes.mjs. Node ships zlib;
 * a ZIP container is a header, the deflated bytes, and a central directory, so
 * pulling in an archiver for one 18 KB text file would be the wrong trade.
 */

import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'skill');
const OUT_DIR = join(ROOT, 'dist');
const OUT = join(OUT_DIR, 'macromiser-coach.zip');

/** The folder name inside the zip. claude.ai keys the Skill on it, so changing
 *  it would upload a SECOND skill rather than update the existing one. */
const SKILL_DIR = 'macromiser-coach';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** DOS date/time, which is what the ZIP format stores. */
function dosStamp(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function zipOne(name, data, mtime) {
  const nameBuf = Buffer.from(name, 'utf8');
  const deflated = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const { time, date } = dosStamp(mtime);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // local file header
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
  local.writeUInt16LE(8, 8); // method: deflate
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); // central directory header
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42); // offset, patched by the caller

  return { local, nameBuf, deflated, central };
}

function build() {
  const entryFile = join(SRC_DIR, 'SKILL.md');
  const md = readFileSync(entryFile);

  // A Claude Skill needs YAML frontmatter with a name and a description; the
  // description is what decides whether the Skill triggers at all. Fail loudly
  // rather than shipping an artifact that silently never fires.
  const text = md.toString('utf8');
  const NL = String.fromCharCode(10);
  if (!text.startsWith('---' + NL)) {
    throw new Error('skill/SKILL.md must open with YAML frontmatter (---).');
  }
  const fmEnd = text.indexOf(NL + '---', 4);
  if (fmEnd < 0) throw new Error('skill/SKILL.md frontmatter is not closed.');
  const fm = text.slice(4, fmEnd);
  for (const key of ['name:', 'description:']) {
    if (!fm.includes(key)) throw new Error(`skill/SKILL.md frontmatter is missing "${key}"`);
  }
  const name = /name:\s*(.+)/.exec(fm)?.[1]?.trim();
  if (name !== SKILL_DIR) {
    throw new Error(
      `frontmatter name "${name}" does not match the zip folder "${SKILL_DIR}". ` +
        'Uploading that would create a second skill rather than update the existing one.',
    );
  }

  // SKILL.md first, then the rest alphabetically — a reader unzipping this by
  // hand should meet the entry point before its appendices.
  const files = readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => (a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a.localeCompare(b)));

  // Every supporting file must be referenced from SKILL.md, or it is dead
  // weight the model will never open.
  for (const f of files) {
    if (f === 'SKILL.md') continue;
    if (!text.includes(f)) {
      throw new Error(`skill/${f} is never referenced from SKILL.md — the model would never read it.`);
    }
  }

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const data = readFileSync(join(SRC_DIR, f));
    const e = zipOne(`${SKILL_DIR}/${f}`, data, statSync(join(SRC_DIR, f)).mtime);
    e.central.writeUInt32LE(offset, 42); // where this entry's local header starts
    const local = Buffer.concat([e.local, e.nameBuf, e.deflated]);
    offset += local.length;
    locals.push(local);
    centrals.push(Buffer.concat([e.central, e.nameBuf]));
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(files.length, 8); // entries on this disk
  end.writeUInt16LE(files.length, 10); // total entries
  end.writeUInt32LE(centralPart.length, 12);
  end.writeUInt32LE(localPart.length, 16);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, Buffer.concat([localPart, centralPart, end]));

  for (const f of files) {
    const n = readFileSync(join(SRC_DIR, f), 'utf8').split(NL).length;
    console.log(`  ${SKILL_DIR}/${f.padEnd(14)} ${String(n).padStart(4)} lines`);
  }
  console.log(`-> dist/macromiser-coach.zip, ${statSync(OUT).size} bytes packed`);
  console.log('');
  // Settings moved: Skills and Connectors now live under Customize, not
  // Capabilities (confirmed in the UI 2026-08-24).
  console.log('Upload at claude.ai -> Settings -> Customize -> Skills.');
  console.log('Replace the existing "macromiser-coach"; do not add a second one.');
  console.log('The zip FILENAME does not matter — identity comes from the');
  console.log('frontmatter name and the folder inside the archive.');

  buildSingle(files, text, NL);
}

/**
 * Fallback: one file, REFERENCE.md folded in as an appendix.
 *
 * Loses progressive disclosure — everything is in context on every trigger —
 * but that is strictly better than a supporting file the surface can never
 * open. Same frontmatter and same folder name, so it updates the same Skill.
 */
function buildSingle(files, entryText, NL) {
  const extras = files.filter((f) => f !== 'SKILL.md');
  if (extras.length === 0) return;

  let merged = entryText;

  // The split-file pointer is wrong once everything is in one file. Plain
  // string surgery rather than a regex — the escaping is easier to keep right.
  const pStart = merged.indexOf('**`REFERENCE.md` sits alongside');
  const pEnd = merged.indexOf('what to bench.', pStart);
  if (pStart >= 0 && pEnd > pStart) {
    merged =
      merged.slice(0, pStart) +
      '**Appendix A below holds the per-tool semantics** — what a null means, ' +
      'which fields are traps, how each write behaves. Consult it when you are ' +
      'about to use a tool you have not used this session, rather than reading ' +
      'it end to end.' +
      merged.slice(pEnd + 'what to bench.'.length);
  }
  merged = merged.split('`REFERENCE.md` covers').join('Appendix A covers');
  merged = merged.split('See `REFERENCE.md` for').join('See Appendix A for');

  for (const f of extras) {
    const body = readFileSync(join(SRC_DIR, f), 'utf8');
    // Drop the appendix's own H1 and re-title it in place.
    const firstBreak = body.indexOf(NL);
    const stripped = body.startsWith('#') ? body.slice(firstBreak + 1) : body;
    merged += NL + '---' + NL + NL + '# Appendix A — tool reference' + NL + stripped;
  }

  const out = join(OUT_DIR, 'macromiser-coach-single.zip');
  const e = zipOne(`${SKILL_DIR}/SKILL.md`, Buffer.from(merged, 'utf8'), new Date());
  e.central.writeUInt32LE(0, 42);
  const local = Buffer.concat([e.local, e.nameBuf, e.deflated]);
  const central = Buffer.concat([e.central, e.nameBuf]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  writeFileSync(out, Buffer.concat([local, central, end]));

  console.log('');
  console.log(`Fallback: dist/macromiser-coach-single.zip (${merged.split(NL).length} lines, one file).`);
  console.log('Use it if the split version never reads its appendix — on claude.ai');
  console.log('that means code execution is disabled.');
}

build();
