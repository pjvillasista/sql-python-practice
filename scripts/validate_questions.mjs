#!/usr/bin/env node
// Static validator for questions/*.json. Node 18+, no dependencies.
//
// Checks: JSON parses; required fields and types; enums; unique ids; id matches
// filename; index.json lists exactly the question files with matching metadata;
// every declared table is created (CREATE TABLE <name>) in both seed and
// hidden_seed; Python questions define `def <entry>(` in solution and starter.
//
// It does NOT execute SQL or Python. Execution checks (seeds run, schema matches
// DuckDB's types, reference returns rows on both datasets, trap solutions fail)
// run in the browser: serve the repo and open /validate.html.
//
// Usage: node scripts/validate_questions.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSqlStatements, stripSqlComments } from '../assets/js/sql-utils.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'questions');
const DIFFICULTIES = ['easy', 'medium', 'hard', 'extreme'];
const LANGUAGES = ['sql', 'python'];
const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

function readJson(file) {
  try {
    return JSON.parse(readFileSync(join(dir, file), 'utf8'));
  } catch (e) {
    err(file, `invalid JSON: ${e.message}`);
    return null;
  }
}

function createdTables(sql) {
  const names = new Set();
  for (const stmt of splitSqlStatements(sql)) {
    const m = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?)([A-Za-z_][\w]*)\1/i.exec(stripSqlComments(stmt));
    if (m) names.add(m[2].toLowerCase());
  }
  return names;
}

function checkQuestion(file, q) {
  const required = ['id', 'title', 'difficulty', 'language', 'tags', 'prompt', 'tables', 'seed', 'hidden_seed', 'solution', 'ordered', 'hints', 'explanation', 'starter'];
  for (const k of required) if (!(k in q)) err(file, `missing field "${k}"`);
  for (const k of ['id', 'title', 'prompt', 'seed', 'hidden_seed', 'solution', 'explanation', 'starter']) {
    if (k in q && !isStr(q[k])) err(file, `"${k}" must be a non-empty string`);
  }
  if (q.id && file !== `${q.id}.json`) err(file, `id "${q.id}" does not match filename`);
  if (q.id && !/^[a-z0-9-]+$/.test(q.id)) err(file, 'id must be lowercase letters, digits and dashes');
  if (!DIFFICULTIES.includes(q.difficulty)) err(file, `difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  if (!LANGUAGES.includes(q.language)) err(file, `language must be one of ${LANGUAGES.join(', ')}`);
  if (!Array.isArray(q.tags) || q.tags.length === 0 || !q.tags.every(isStr)) err(file, 'tags must be a non-empty array of strings');
  if (typeof q.ordered !== 'boolean') err(file, 'ordered must be a boolean');
  if (!Array.isArray(q.hints) || !q.hints.every(isStr)) err(file, 'hints must be an array of strings');
  if ('tolerance' in q && !(typeof q.tolerance === 'number' && q.tolerance >= 0)) err(file, 'tolerance must be a non-negative number');

  if (!Array.isArray(q.tables) || q.tables.length === 0) {
    err(file, 'tables must be a non-empty array');
  } else {
    const seedTables = isStr(q.seed) ? createdTables(q.seed) : new Set();
    const hiddenTables = isStr(q.hidden_seed) ? createdTables(q.hidden_seed) : new Set();
    for (const t of q.tables) {
      if (!isStr(t.name)) {
        err(file, 'every table needs a name');
        continue;
      }
      if (!Array.isArray(t.columns) || t.columns.length === 0 || !t.columns.every((c) => isStr(c.name) && isStr(c.type))) {
        err(file, `table ${t.name}: columns must be [{name, type}]`);
      }
      if (!seedTables.has(t.name.toLowerCase())) err(file, `seed does not CREATE TABLE ${t.name}`);
      if (!hiddenTables.has(t.name.toLowerCase())) err(file, `hidden_seed does not CREATE TABLE ${t.name}`);
    }
    if (isStr(q.seed) && isStr(q.hidden_seed) && q.seed.trim() === q.hidden_seed.trim()) err(file, 'hidden_seed is identical to seed');
  }

  if (q.language === 'python') {
    const entry = q.python?.entry;
    if (!isStr(entry) || !isStr(q.python?.signature)) err(file, 'python questions need python.entry and python.signature');
    else {
      const re = new RegExp(`^def\\s+${entry}\\s*\\(`, 'm');
      if (!re.test(q.solution || '')) err(file, `solution does not define ${entry}(...)`);
      if (!re.test(q.starter || '')) err(file, `starter does not define ${entry}(...)`);
    }
  }
  if ('trap_solutions' in q) {
    if (!Array.isArray(q.trap_solutions) || !q.trap_solutions.every((t) => isStr(t.code) && isStr(t.note))) {
      err(file, 'trap_solutions must be [{note, code}]');
    }
  }
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
const questions = new Map();
for (const f of files) {
  const q = readJson(f);
  if (!q) continue;
  checkQuestion(f, q);
  if (q.id) {
    if (questions.has(q.id)) err(f, `duplicate id "${q.id}"`);
    questions.set(q.id, q);
  }
}

const index = readJson('index.json');
if (index) {
  if (!Array.isArray(index.questions)) err('index.json', 'must be {"questions": [...]}');
  else {
    const seen = new Set();
    for (const entry of index.questions) {
      if (seen.has(entry.id)) err('index.json', `duplicate id "${entry.id}"`);
      seen.add(entry.id);
      const q = questions.get(entry.id);
      if (!q) {
        err('index.json', `lists "${entry.id}" but questions/${entry.id}.json does not exist`);
        continue;
      }
      for (const k of ['title', 'difficulty', 'language']) {
        if (entry[k] !== q[k]) err('index.json', `${entry.id}.${k} is "${entry[k]}" but the question file says "${q[k]}"`);
      }
      if (JSON.stringify(entry.tags) !== JSON.stringify(q.tags)) err('index.json', `${entry.id}.tags differ from the question file`);
    }
    for (const id of questions.keys()) if (!seen.has(id)) err('index.json', `missing entry for "${id}"`);
  }
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s):\n` + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
const count = (lang) => [...questions.values()].filter((q) => q.language === lang).length;
console.log(`✓ ${questions.size} questions OK (${count('sql')} SQL, ${count('python')} Python). Static checks only; open /validate.html in a browser to execute them.`);
