import {
  Address,
  LabelValidationError,
  NormalizedLabel,
  ValidateOptions,
  ValidationIssue,
  Weight,
  WeightUnit,
} from './types.js';

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

const CA_PROVINCE_CODES = new Set([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);

// Only the formats we can check with confidence. Anything else falls back
// to a loose length check rather than a false claim of validation.
const POSTAL_CODE_PATTERNS: Record<string, RegExp> = {
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/,
};

const WEIGHT_UNITS = new Set<WeightUnit>(['lb', 'kg', 'oz', 'g']);
const WEIGHT_PATTERN = /^(\d+(?:\.\d+)?)\s*(lb|kg|oz|g)$/i;

const KNOWN_SERVICES = new Set(['ground', 'priority', 'express', 'overnight']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === 'string' ? value : undefined;
}

function addIssue(
  issues: ValidationIssue[],
  path: string,
  message: string,
  severity: 'error' | 'warning' = 'error',
): void {
  issues.push({ path, message, severity });
}

function validateAddress(
  raw: unknown,
  path: string,
  lenient: boolean,
  issues: ValidationIssue[],
): Address | undefined {
  if (!isRecord(raw)) {
    addIssue(issues, path, 'address must be an object');
    return undefined;
  }

  const name = getString(raw, 'name');
  if (!name?.trim()) addIssue(issues, `${path}.name`, 'name is required');

  const line1 = getString(raw, 'line1');
  if (!line1?.trim()) addIssue(issues, `${path}.line1`, 'line1 is required');

  const city = getString(raw, 'city');
  if (!city?.trim()) addIssue(issues, `${path}.city`, 'city is required');

  let country = getString(raw, 'country')?.trim().toUpperCase();
  if (!country) {
    addIssue(issues, `${path}.country`, 'country is required (ISO 3166-1 alpha-2)');
  } else if (!/^[A-Z]{2}$/.test(country)) {
    addIssue(issues, `${path}.country`, `country must be a 2-letter ISO code, got "${country}"`);
  }

  let state = (getString(raw, 'state') ?? '').trim();
  if (country === 'US' || country === 'CA') {
    const codes = country === 'US' ? US_STATE_CODES : CA_PROVINCE_CODES;
    const normalized = state.toUpperCase();
    if (!codes.has(normalized)) {
      const kind = country === 'US' ? 'US state' : 'Canadian province';
      if (lenient) {
        addIssue(issues, `${path}.state`, `unrecognized ${kind} code "${state}", keeping as-is`, 'warning');
      } else {
        addIssue(issues, `${path}.state`, `state must be a valid ${kind} code, got "${state}"`);
      }
    }
    state = normalized;
  } else if (!state && !lenient) {
    addIssue(issues, `${path}.state`, 'state/province is required');
  }

  const postalCode = (getString(raw, 'postalCode') ?? '').trim();
  if (!postalCode) {
    addIssue(issues, `${path}.postalCode`, 'postalCode is required');
  } else {
    const pattern = country ? POSTAL_CODE_PATTERNS[country] : undefined;
    if (pattern && !pattern.test(postalCode)) {
      const message = `postal code "${postalCode}" does not match the expected ${country} format`;
      if (lenient) {
        addIssue(issues, `${path}.postalCode`, `${message}, keeping as-is`, 'warning');
      } else {
        addIssue(issues, `${path}.postalCode`, message);
      }
    } else if (!pattern && postalCode.length > 12) {
      addIssue(issues, `${path}.postalCode`, `postal code "${postalCode}" is longer than expected`, lenient ? 'warning' : 'error');
    }
  }

  const company = getString(raw, 'company')?.trim();
  const line2 = getString(raw, 'line2')?.trim();

  return {
    name: (name ?? '').trim(),
    company: company || undefined,
    line1: (line1 ?? '').trim(),
    line2: line2 || undefined,
    city: (city ?? '').trim(),
    state,
    postalCode,
    country: country ?? '',
  };
}

function parseWeight(
  raw: unknown,
  lenient: boolean,
  path: string,
  issues: ValidationIssue[],
): Weight | undefined {
  if (raw === undefined || raw === null) {
    addIssue(issues, path, 'weight is required');
    return undefined;
  }

  if (isRecord(raw)) {
    const value = raw.value;
    const unit = raw.unit;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      addIssue(issues, `${path}.value`, 'weight value must be a positive number');
      return undefined;
    }
    const normalizedUnit = typeof unit === 'string' ? (unit.toLowerCase() as WeightUnit) : undefined;
    if (!normalizedUnit || !WEIGHT_UNITS.has(normalizedUnit)) {
      addIssue(issues, `${path}.unit`, 'weight unit must be one of: lb, kg, oz, g');
      return undefined;
    }
    return { value, unit: normalizedUnit };
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const withUnit = WEIGHT_PATTERN.exec(trimmed);
    if (withUnit) {
      return { value: Number(withUnit[1]), unit: withUnit[2].toLowerCase() as WeightUnit };
    }
    const bare = Number(trimmed);
    if (trimmed !== '' && !Number.isNaN(bare)) {
      return resolveUnitlessWeight(bare, raw, lenient, path, issues);
    }
    addIssue(issues, path, `weight "${raw}" is not a recognized format (expected e.g. "5lb", "2.3kg")`);
    return undefined;
  }

  if (typeof raw === 'number') {
    return resolveUnitlessWeight(raw, String(raw), lenient, path, issues);
  }

  addIssue(issues, path, 'weight must be a string, number, or {value, unit} object');
  return undefined;
}

function resolveUnitlessWeight(
  value: number,
  display: string,
  lenient: boolean,
  path: string,
  issues: ValidationIssue[],
): Weight | undefined {
  if (!Number.isFinite(value) || value <= 0) {
    addIssue(issues, path, 'weight must be a positive number');
    return undefined;
  }
  if (lenient) {
    addIssue(issues, path, `weight "${display}" has no unit, assuming pounds`, 'warning');
    return { value, unit: 'lb' };
  }
  addIssue(issues, path, `weight "${display}" has no unit; write it as e.g. "${display}lb" or pass --lenient`);
  return undefined;
}

function validateService(raw: unknown, lenient: boolean, issues: ValidationIssue[]): string {
  if (raw === undefined) return 'ground';
  if (typeof raw !== 'string') {
    addIssue(issues, 'service', 'service must be a string');
    return 'ground';
  }
  const normalized = raw.trim().toLowerCase();
  if (!KNOWN_SERVICES.has(normalized)) {
    if (lenient) {
      addIssue(issues, 'service', `unrecognized service "${raw}", keeping as-is`, 'warning');
    } else {
      addIssue(issues, 'service', `service must be one of: ${[...KNOWN_SERVICES].join(', ')}`);
    }
  }
  return normalized;
}

/**
 * Validate and normalize a shipping label request. Strict by default:
 * ambiguous input (a bare weight number, an unrecognized state code) is
 * rejected rather than guessed at. Pass { lenient: true } to accept those
 * cases, with the guess recorded as a warning on the thrown error's issues
 * list (or simply returned, when there are no hard errors).
 */
export function validateLabel(input: unknown, options: ValidateOptions = {}): NormalizedLabel {
  const lenient = options.lenient ?? false;
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    throw new LabelValidationError([{ path: '$', message: 'label request must be an object', severity: 'error' }]);
  }

  const from = validateAddress(input.from, 'from', lenient, issues);
  const to = validateAddress(input.to, 'to', lenient, issues);
  const weight = parseWeight(input.weight, lenient, 'weight', issues);
  const service = validateService(input.service, lenient, issues);

  const hasErrors = issues.some((issue) => issue.severity === 'error');
  if (hasErrors || !from || !to || !weight) {
    throw new LabelValidationError(issues);
  }

  return { from, to, weight, service };
}
