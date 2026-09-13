# shipping-label-kit

A small TypeScript library (and a thin CLI on top) for validating and
normalizing shipping label data before it goes anywhere near a carrier API
or a label printer.

## The problem

Shipping label input usually comes from somewhere messy: a spreadsheet
export, a customer-entered form, an upstream system with its own idea of
what a valid address looks like. Two things go wrong with that data
constantly:

- A weight shows up as a bare number (`"5"`) with no indication of whether
  that's pounds or kilograms. Guess wrong and the label is wrong.
- A state or postal code is malformed or free-typed (`"California"` instead
  of `"CA"`, a 4-digit US ZIP). Some carrier APIs reject it outright with an
  unhelpful error; others silently accept it and print a bad label.

This library validates that data up front. By default it is strict: if the
weight has no unit or a state code isn't recognized, it fails loudly with a
list of exactly what's wrong, instead of guessing and printing a label
nobody checked. When you know your input is messy and want best-effort
normalization instead, pass `--lenient` (or `{ lenient: true }` in code) and
it will fill in reasonable defaults, reporting each guess as a warning.

## Usage

### As a library

```ts
import { validateLabel, LabelValidationError } from 'shipping-label-kit';

const request = {
  from: {
    name: 'Warehouse Co',
    line1: '400 Industrial Way',
    city: 'Reno',
    state: 'NV',
    postalCode: '89501',
    country: 'US',
  },
  to: {
    name: 'Jamie Rivera',
    line1: '12 Elm St',
    city: 'Austin',
    state: 'TX',
    postalCode: '78701',
    country: 'US',
  },
  weight: '4.2lb',
  service: 'priority',
};

try {
  const label = validateLabel(request);
  console.log(label);
} catch (err) {
  if (err instanceof LabelValidationError) {
    for (const issue of err.issues) {
      console.error(`${issue.severity}: ${issue.path}: ${issue.message}`);
    }
  }
}
```

A weight of `4.2` instead of `"4.2lb"` throws in strict mode:

```
error: weight: weight "4.2" has no unit; write it as e.g. "4.2lb" or pass --lenient
```

Passing `{ lenient: true }` accepts it and assumes pounds, recording that
guess as a warning instead of failing the whole request.

### As a CLI

```
shiplabel request.json
shiplabel request.json --lenient --pretty
```

Reads a JSON file shaped like the object above, prints the normalized label
as JSON on success, or prints one `error:`/`warning:` line per issue to
stderr and exits non-zero on failure.

## Building

There's nothing to install for the library itself — it has no runtime
dependencies. To compile the TypeScript sources you'll need the TypeScript
compiler on your machine (`npm i -g typescript` or `npx tsc`), and if your
editor wants type information for Node's built-in modules, `@types/node` as
a dev-only install. Neither is a dependency of the published package.

```
tsc
node dist/cli.js request.json
```

## Current scope

Postal code format checking currently only covers US and CA; other
countries get a loose length check instead of a real pattern match. See the
issues list on a `LabelValidationError` for exactly what failed and why.
