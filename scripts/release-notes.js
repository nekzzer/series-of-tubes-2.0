#!/usr/bin/env node
// Prints the CHANGELOG.md bullets for one version as a JSON array of strings.
// Usage: node scripts/release-notes.js 1.2.0
const fs = require('node:fs');
const path = require('node:path');

const version = process.argv[2];
const text = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const lines = text.split('\n');
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
const notes = [];
if (start >= 0) {
  for (let i = start + 1; i < lines.length && !lines[i].startsWith('## ['); i++) {
    const l = lines[i];
    if (/^\s*-\s+/.test(l)) notes.push(l.replace(/^\s*-\s+/, '').trim());
    else if (/^\s{2,}\S/.test(l) && notes.length) notes[notes.length - 1] += ' ' + l.trim();
  }
}
process.stdout.write(JSON.stringify(notes));
