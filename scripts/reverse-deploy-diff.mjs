import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'acorn';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

const [oldBundlePath, newBundlePath, sourceMapPath, mode = 'details', requestedSource = ''] = process.argv.slice(2);
if (!oldBundlePath || !newBundlePath || !sourceMapPath) {
  console.error('usage: node scripts/reverse-deploy-diff.mjs <old.js> <new.js> <old.js.map>');
  process.exit(2);
}

const read = (file) => fs.readFileSync(file, 'utf8');
const oldCode = read(oldBundlePath);
const newCode = read(newBundlePath);
const traceMap = new TraceMap(JSON.parse(read(sourceMapPath)));

function lineStarts(code) {
  const starts = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function generatedPosition(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (starts[middle] <= offset) low = middle + 1;
    else high = middle - 1;
  }
  const lineIndex = Math.max(0, high);
  return { line: lineIndex + 1, column: offset - starts[lineIndex] };
}

function collectLiterals(code) {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const rows = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Literal' && typeof node.value === 'string' && node.value.length >= 4) {
      rows.push({ value: node.value, start: node.start });
    } else if (node.type === 'TemplateElement' && node.value.raw.length >= 4) {
      rows.push({ value: node.value.cooked ?? node.value.raw, start: node.start });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end' || key === 'loc') continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value);
    }
  };
  visit(ast);
  return rows.sort((left, right) => left.start - right.start);
}

function counts(rows) {
  const result = new Map();
  for (const row of rows) result.set(row.value, (result.get(row.value) ?? 0) + 1);
  return result;
}

const oldRows = collectLiterals(oldCode);
const newRows = collectLiterals(newCode);
const oldCounts = counts(oldRows);
const newCounts = counts(newRows);
const oldUnique = new Map();
for (const row of oldRows) {
  if (oldCounts.get(row.value) === 1 && newCounts.get(row.value) === 1) oldUnique.set(row.value, row);
}

const oldStarts = lineStarts(oldCode);
const mappedSource = (oldRow) => {
  const generated = generatedPosition(oldStarts, oldRow.start);
  const original = originalPositionFor(traceMap, generated);
  if (!original.source) return null;
  return `${path.basename(original.source)}:${original.line ?? '?'}`;
};

const newOnly = [];
const remaining = new Map(oldCounts);
for (let index = 0; index < newRows.length; index += 1) {
  const row = newRows[index];
  const available = remaining.get(row.value) ?? 0;
  if (available > 0) {
    remaining.set(row.value, available - 1);
    continue;
  }
  let anchor = null;
  for (let distance = 1; distance <= 80 && !anchor; distance += 1) {
    for (const candidateIndex of [index - distance, index + distance]) {
      const candidate = newRows[candidateIndex];
      if (!candidate) continue;
      const oldRow = oldUnique.get(candidate.value);
      if (oldRow) {
        anchor = { source: mappedSource(oldRow), value: candidate.value };
        break;
      }
    }
  }
  newOnly.push({ ...row, anchor });
}

const grouped = new Map();
for (const row of newOnly) {
  const source = row.anchor?.source ?? '(unmapped)';
  const key = source.split(':')[0];
  const group = grouped.get(key) ?? [];
  group.push(row);
  grouped.set(key, group);
}

for (const [source, rows] of [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)) {
  if (requestedSource && !source.toLowerCase().includes(requestedSource.toLowerCase())) continue;
  console.log(`\n## ${source} (${rows.length})`);
  if (mode === 'summary') continue;
  for (const row of rows) {
    const value = row.value.replace(/\s+/g, ' ').slice(0, 240);
    console.log(`- [${row.anchor?.source ?? '?'}] ${JSON.stringify(value)}`);
  }
}
