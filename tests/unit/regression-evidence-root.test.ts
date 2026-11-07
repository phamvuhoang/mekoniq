import { expect, test } from 'vitest';
import { regressionRoot } from '../support/regression-identity';

test('without the variable acceptance keeps reading the historical regression directory', () => {
  expect(regressionRoot(undefined, '/w/lab')).toBe('/w/lab/docs/implementation/evidence/digital-twin-v2/regression');
  expect(regressionRoot('', '/w/lab')).toBe('/w/lab/docs/implementation/evidence/digital-twin-v2/regression');
});
test('a relative root is resolved against the Lab and an absolute root is used as given', () => {
  expect(regressionRoot('docs/implementation/evidence/physical-robot-lab/regression', '/w/lab')).toBe('/w/lab/docs/implementation/evidence/physical-robot-lab/regression');
  expect(regressionRoot('/var/evidence/run-1', '/w/lab')).toBe('/var/evidence/run-1');
});
