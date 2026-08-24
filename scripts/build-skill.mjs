#!/usr/bin/env node
/**
 * Pack skill/SKILL.md into dist/macromiser-coach.zip, ready to upload to
 * claude.ai as a Claude Skill.
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

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'skill', 'SKILL.md');
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
  const md = readFileSync(SRC);

  // A Claude Skill needs YAML frontmatter with a name and a description; the
  // description is what decides whether the Skill triggers at all. Fail loudly
  // rather than shipping an artifact that silently never fires.
  const text = md.toString('utf8');
  if (!text.startsWith('---\n')) {
    throw new Error('skill/SKILL.md must open with YAML frontmatter (---).');
  }
  const fm = text.slice(4, text.indexOf('\n---', 4));
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

  const entry = zipOne(`${SKILL_DIR}/SKILL.md`, md, statSync(SRC).mtime);
  entry.central.writeUInt32LE(0, 42); // single entry, so offset is 0

  const localPart = Buffer.concat([entry.local, entry.nameBuf, entry.deflated]);
  const centralPart = Buffer.concat([entry.central, entry.nameBuf]);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(1, 8); // entries on this disk
  end.writeUInt16LE(1, 10); // total entries
  end.writeUInt32LE(centralPart.length, 12);
  end.writeUInt32LE(localPart.length, 16);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, Buffer.concat([localPart, centralPart, end]));

  const lines = text.split('\n').length;
  console.log(`skill/SKILL.md (${lines} lines, ${md.length} bytes)`);
  console.log(`  -> ${OUT.replace(ROOT + '\\', '').replace(ROOT + '/', '')} as ${SKILL_DIR}/SKILL.md`);
  console.log(`  ${statSync(OUT).size} bytes packed`);
  console.log('');
  // Settings moved: Skills and Connectors now live under Customize, not
  // Capabilities (confirmed in the UI 2026-08-24).
  console.log('Upload at claude.ai -> Settings -> Customize -> Skills.');
  console.log('Replace the existing "macromiser-coach"; do not add a second one.');
  console.log('The zip FILENAME does not matter — identity comes from the');
  console.log('frontmatter name and the folder inside the archive.');
}

build();
