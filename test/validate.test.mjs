// Plain .mjs against the built output: type-checking a node:test import
// would need @types/node, and this project has no dependencies.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LabelValidationError, validateLabel } from '../dist/index.js';

const from = {
  name: 'Warehouse 4',
  line1: '100 Dock St',
  city: 'Portland',
  state: 'or',
  postalCode: '97201',
  country: 'us',
};

const to = {
  name: 'Sam Rivera',
  company: '  ',
  line1: ' 55 Elm Ave ',
  line2: 'Apt 3',
  city: 'Toronto',
  state: 'on',
  postalCode: 'M5V 2T6',
  country: 'CA',
};

function request(overrides = {}) {
  return { from: { ...from }, to: { ...to }, weight: '5lb', ...overrides };
}

function issuesFor(input, options) {
  try {
    validateLabel(input, options);
  } catch (err) {
    assert.ok(err instanceof LabelValidationError);
    return err.issues;
  }
  assert.fail('expected validation to throw');
}

test('normalizes a valid request', () => {
  const label = validateLabel(request());
  assert.equal(label.from.state, 'OR');
  assert.equal(label.from.country, 'US');
  assert.equal(label.to.line1, '55 Elm Ave');
  assert.equal(label.to.company, undefined);
  assert.equal(label.to.state, 'ON');
  assert.deepEqual(label.weight, { value: 5, unit: 'lb' });
  assert.equal(label.service, 'ground');
});

test('rejects a non-object request', () => {
  const issues = issuesFor('nope');
  assert.equal(issues[0].path, '$');
});

test('reports missing required address fields with their paths', () => {
  const issues = issuesFor(request({ to: { country: 'US', state: 'NY', postalCode: '10001' } }));
  const paths = issues.map((i) => i.path);
  assert.ok(paths.includes('to.name'));
  assert.ok(paths.includes('to.line1'));
  assert.ok(paths.includes('to.city'));
});

test('rejects a bad country code', () => {
  const issues = issuesFor(request({ from: { ...from, country: 'USA' } }));
  assert.ok(issues.some((i) => i.path === 'from.country'));
});

test('rejects an unknown US state in strict mode, warns in lenient', () => {
  const bad = request({ from: { ...from, state: 'ZZ' } });
  assert.ok(issuesFor(bad).some((i) => i.path === 'from.state' && i.severity === 'error'));
  // Lenient returns the label; the warning is only visible if something else fails.
  const label = validateLabel(bad, { lenient: true });
  assert.equal(label.from.state, 'ZZ');
});

test('validates US and CA postal code formats', () => {
  assert.equal(validateLabel(request({ from: { ...from, postalCode: '97201-1234' } })).from.postalCode, '97201-1234');
  assert.ok(issuesFor(request({ from: { ...from, postalCode: '9720' } })).some((i) => i.path === 'from.postalCode'));
  assert.ok(issuesFor(request({ to: { ...to, postalCode: '12345' } })).some((i) => i.path === 'to.postalCode'));
});

test('requires state for other countries only in strict mode', () => {
  const foreign = { ...to, country: 'DE', state: '', postalCode: '10115' };
  assert.ok(issuesFor(request({ to: foreign })).some((i) => i.path === 'to.state'));
  assert.equal(validateLabel(request({ to: foreign }), { lenient: true }).to.country, 'DE');
});

test('flags overlong postal codes for countries without a pattern', () => {
  const foreign = { ...to, country: 'DE', state: 'BE', postalCode: '1234567890123' };
  assert.ok(issuesFor(request({ to: foreign })).some((i) => i.path === 'to.postalCode'));
});

test('parses weight strings with units', () => {
  assert.deepEqual(validateLabel(request({ weight: '2.5 KG' })).weight, { value: 2.5, unit: 'kg' });
  assert.deepEqual(validateLabel(request({ weight: '16oz' })).weight, { value: 16, unit: 'oz' });
});

test('parses weight objects and rejects bad ones', () => {
  assert.deepEqual(validateLabel(request({ weight: { value: 300, unit: 'G' } })).weight, { value: 300, unit: 'g' });
  assert.ok(issuesFor(request({ weight: { value: -1, unit: 'lb' } })).some((i) => i.path === 'weight.value'));
  assert.ok(issuesFor(request({ weight: { value: 1, unit: 'stone' } })).some((i) => i.path === 'weight.unit'));
});

test('rejects unitless weights by default', () => {
  for (const weight of [5, '5']) {
    const issues = issuesFor(request({ weight }));
    assert.ok(issues.some((i) => i.path === 'weight' && i.severity === 'error'));
  }
});

test('lenient mode assumes pounds for unitless weights', () => {
  assert.deepEqual(validateLabel(request({ weight: 5 }), { lenient: true }).weight, { value: 5, unit: 'lb' });
  assert.deepEqual(validateLabel(request({ weight: '7.5' }), { lenient: true }).weight, { value: 7.5, unit: 'lb' });
});

test('rejects zero, negative, and garbage weights even when lenient', () => {
  for (const weight of [0, -3, 'heavy', null, undefined, true]) {
    issuesFor(request({ weight }), { lenient: true });
  }
});

test('normalizes service and rejects unknown ones in strict mode', () => {
  assert.equal(validateLabel(request({ service: ' Express ' })).service, 'express');
  assert.ok(issuesFor(request({ service: 'teleport' })).some((i) => i.path === 'service'));
  assert.equal(validateLabel(request({ service: 'teleport' }), { lenient: true }).service, 'teleport');
});

test('error message counts only errors', () => {
  const issues = issuesFor(request({ weight: 5, service: 'teleport' }), { lenient: false });
  const err = new LabelValidationError([...issues, { path: 'x', message: 'w', severity: 'warning' }]);
  assert.match(err.message, /with 2 error\(s\)/);
});
