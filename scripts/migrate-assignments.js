#!/usr/bin/env node
/*
  Migrate assignment.json files from the old flat format to the new nested Passage format.

  Old format (flat):
    questions: [
      { qType: "Passage", qText, image, qOptions: [], qAnswer: [] },
      { qType: "SMCQ" | "MMCQ", qText, image, qOptions, qAnswer, [passageId] },
      ...
    ]

  New format (nested):
    questions: [
      { qType: "Passage", qText, image, questions: [ { ...nonPassage } , ... ] },
      { ...nonPassage },
      ...
    ]

  Usage:
    node scripts/migrate-assignments.js                # migrate all assignments
    node scripts/migrate-assignments.js --dry-run      # analyze only, no writes
    node scripts/migrate-assignments.js --aid 15       # migrate only a specific aID
*/

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'frontend', 'data', 'question_data');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { dryRun: false, aID: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run' || a === '-n') out.dryRun = true;
    else if (a === '--aid' && args[i + 1]) {
      out.aID = String(args[++i]);
    } else if (/^--aid=/.test(a)) {
      out.aID = a.split('=')[1];
    }
  }
  return out;
}

function isNewFormat(data) {
  if (!data || !Array.isArray(data.questions)) return false;
  return data.questions.some(
    (q) => q && q.qType === 'Passage' && Array.isArray(q.questions)
  );
}

function migrateData(oldData) {
  if (!oldData || !Array.isArray(oldData.questions)) {
    return { migrated: false, data: oldData, reason: 'No questions array' };
  }

  if (isNewFormat(oldData)) {
    return { migrated: false, data: oldData, reason: 'Already new format' };
  }

  const out = { ...oldData, questions: [] };
  let currentPassage = null;

  const pushCurrentPassage = () => {
    if (currentPassage) {
      // Only keep passage if it has at least one question; otherwise drop it.
      if (Array.isArray(currentPassage.questions) && currentPassage.questions.length) {
        out.questions.push(currentPassage);
      } else {
        // No sub-questions; treat it as a normal non-passage block by dropping it.
        // Alternatively, could keep an empty passage; but schema requires minItems:1.
      }
    }
    currentPassage = null;
  };

  for (const item of oldData.questions) {
    if (!item || typeof item !== 'object') continue;
    const qType = item.qType;

    if (qType === 'Passage') {
      // Close previous passage (if any)
      pushCurrentPassage();
      currentPassage = {
        qType: 'Passage',
        qText: item.qText || '',
        image: item.image != null ? item.image : null,
        questions: [],
      };
      continue;
    }

    // Non-passage question: strip legacy passage-related fields
    const q = { ...item };
    delete q.passageId;
    delete q.passage;
    delete q.passageImage;

    if (currentPassage) {
      currentPassage.questions.push(q);
    } else {
      out.questions.push(q);
    }
  }

  // Flush any trailing passage
  pushCurrentPassage();

  return { migrated: true, data: out };
}

async function readJSON(file) {
  const raw = await fsp.readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function writeJSON(file, data) {
  const content = JSON.stringify(data, null, 2) + '\n';
  await fsp.writeFile(file, content, 'utf8');
}

async function migrateFile(file, opts) {
  try {
    const oldData = await readJSON(file);
    const { migrated, data, reason } = migrateData(oldData);
    const rel = path.relative(ROOT, file);

    if (!migrated) {
      console.log(`SKIP: ${rel} (${reason})`);
      return false;
    }

    if (opts.dryRun) {
      console.log(`DRY:  ${rel} would be migrated.`);
      return true;
    }

    // Backup once per run (overwrite if exists)
    const bakFile = file.replace(/assignment\.json$/i, 'assignment.json.bak');
    try {
      await fsp.copyFile(file, bakFile);
    } catch (e) {
      // ignore backup errors
    }
    await writeJSON(file, data);
    console.log(`OK:   ${rel}`);
    return true;
  } catch (e) {
    console.error(`ERR:  ${file} -> ${e.message}`);
    return false;
  }
}

async function main() {
  const opts = parseArgs();

  // Resolve target files
  const entries = await fsp.readdir(DATA_DIR, { withFileTypes: true });
  const targets = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const name = ent.name;
    if (opts.aID && String(name) !== String(opts.aID)) continue;
    const file = path.join(DATA_DIR, name, 'assignment.json');
    if (fs.existsSync(file)) targets.push(file);
  }

  if (targets.length === 0) {
    console.log('No assignment.json files found to migrate.');
    process.exit(0);
  }

  let changed = 0;
  for (const f of targets) {
    const ok = await migrateFile(f, opts);
    if (ok) changed++;
  }

  console.log(`\nDone. Processed ${targets.length} file(s). Migrated ${changed}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

