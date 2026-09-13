export type WeightUnit = 'lb' | 'kg' | 'oz' | 'g';

export interface Weight {
  value: number;
  unit: WeightUnit;
}

export interface Address {
  name: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface NormalizedLabel {
  from: Address;
  to: Address;
  weight: Weight;
  service: string;
}

export interface ValidateOptions {
  /**
   * Off by default. Strict mode rejects ambiguous input (a bare weight
   * number with no unit, an unrecognized state code) instead of guessing.
   * Lenient mode fills in reasonable defaults and reports the guess as a
   * warning instead of an error.
   */
  lenient?: boolean;
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export class LabelValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    const errorCount = issues.filter((i) => i.severity === 'error').length;
    super(`shipping label failed validation with ${errorCount} error(s)`);
    this.name = 'LabelValidationError';
    this.issues = issues;
  }
}
