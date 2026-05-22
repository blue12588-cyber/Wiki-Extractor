/**
 * Schema validation via ajv.
 *
 * Authority: agreed_contract.json#AC-6.
 *
 * Both schemas live under `shared/schemas/`. We load them eagerly here so the
 * validator is hot-path-free at call time.
 */

import Ajv2020 from 'ajv/dist/2020';
import type { ErrorObject } from 'ajv';
import candidateSchema from '../../../shared/schemas/candidate_item.schema.json' with { type: 'json' };
import wikiEntrySchema from '../../../shared/schemas/wiki_entry.schema.json' with { type: 'json' };

const ajv = new Ajv2020({ allErrors: true, strict: false });
const candidateValidator = ajv.compile(candidateSchema as object);
const wikiEntryValidator = ajv.compile(wikiEntrySchema as object);

export interface ValidationResult {
  ok: boolean;
  errors: ErrorObject[];
  invalidCount: number;
  validCount: number;
}

export function validateCandidates(items: unknown[]): ValidationResult {
  const errors: ErrorObject[] = [];
  let valid = 0;
  let invalid = 0;
  for (let i = 0; i < items.length; i++) {
    const ok = candidateValidator(items[i]);
    if (ok) {
      valid++;
    } else {
      invalid++;
      const errs = candidateValidator.errors ?? [];
      for (const e of errs) {
        // Prefix instancePath with item index for clarity.
        errors.push({
          ...e,
          instancePath: `/${i}${e.instancePath ?? ''}`,
        });
      }
    }
  }
  return { ok: invalid === 0, errors, invalidCount: invalid, validCount: valid };
}

export function validateWikiEntry(entry: unknown): ValidationResult {
  const ok = wikiEntryValidator(entry);
  if (ok) {
    return { ok: true, errors: [], invalidCount: 0, validCount: 1 };
  }
  return {
    ok: false,
    errors: wikiEntryValidator.errors ?? [],
    invalidCount: 1,
    validCount: 0,
  };
}
