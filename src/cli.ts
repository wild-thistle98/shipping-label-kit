#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { LabelValidationError, validateLabel } from './validate.js';

function main(): void {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      lenient: { type: 'boolean', default: false },
      pretty: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  const file = positionals[0];
  if (!file) {
    process.stderr.write('usage: shiplabel <request.json> [--lenient] [--pretty]\n');
    process.exitCode = 2;
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    process.stderr.write(`could not read or parse ${file}: ${(err as Error).message}\n`);
    process.exitCode = 2;
    return;
  }

  try {
    const label = validateLabel(raw, { lenient: values.lenient });
    process.stdout.write(JSON.stringify(label, null, values.pretty ? 2 : 0) + '\n');
  } catch (err) {
    if (err instanceof LabelValidationError) {
      for (const issue of err.issues) {
        process.stderr.write(`${issue.severity}: ${issue.path}: ${issue.message}\n`);
      }
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

main();
