// Runs the shared mixer's Python tests (tests/test_reelmix.py) as part of `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const probe = spawnSync('python', ['-c', 'import numpy, scipy, pytest'], { encoding: 'utf8' });
test('reelmix (Python): shared mixer roles, ducking, onsets, master, bed, overrides', { skip: probe.status !== 0 && 'python with numpy, scipy and pytest not available' }, () => {
  const r = spawnSync('python', ['-m', 'pytest', 'tests/test_reelmix.py', '-q', '-p', 'no:cacheprovider'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
