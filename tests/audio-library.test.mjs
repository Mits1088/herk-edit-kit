// House sound library: CC0-only licence check on the source page, search, and the committed index's shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { licenceFromPage, search, readIndex } from '../scripts/audio/library.mjs';

test('licence check: CC0 and PDM accepted; attribution, NC and missing licences refused', () => {
  assert.deepEqual(licenceFromPage('<a href="https://creativecommons.org/publicdomain/zero/1.0/">Creative Commons 0</a>').licence, 'CC0-1.0');
  assert.equal(licenceFromPage('<a href="https://creativecommons.org/publicdomain/mark/1.0/">PDM</a>').ok, true);
  assert.equal(licenceFromPage('<a href="https://creativecommons.org/licenses/by/4.0/">CC BY</a>').ok, false);
  assert.equal(licenceFromPage('CC0 claimed <a href="https://creativecommons.org/publicdomain/zero/1.0/"></a> but <a href="https://creativecommons.org/licenses/by-nc/3.0/">').ok, false);
  assert.equal(licenceFromPage('<html>no licence here</html>').ok, false);
});

test('search ranks by matching words and filters by role', () => {
  const index = { sounds: [
    { id: 'crowd-roar', role: 'hero', about: 'crowd erupts', tags: ['cheer', 'stadium'] },
    { id: 'key-tick', role: 'foley', about: 'keyboard tick', tags: ['typing'] },
  ] };
  assert.deepEqual(search(index, ['crowd', 'cheer']).map((s) => s.id), ['crowd-roar']);
  assert.deepEqual(search(index, ['tick'], 'hero'), []);
});

test('every library entry is CC0/PDM with provenance and a role the profile knows', () => {
  const profile = JSON.parse(readFileSync(new URL('../audio-library/house-profile.json', import.meta.url), 'utf8'));
  for (const s of readIndex().sounds) {
    assert.ok(['CC0-1.0', 'PDM-1.0'].includes(s.licence), `${s.id}: ${s.licence}`);
    assert.ok(s.source_url && s.sha256 && s.verified_at, `${s.id}: provenance`);
    assert.ok(profile.roles[s.role], `${s.id}: role ${s.role}`);
  }
});
