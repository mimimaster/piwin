import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDeveloperIdIdentities, resolveSigningIdentity } from './signing-identity.mjs';

const FIND_IDENTITY = `  1) F5F158C88F19A87FC0A2EA1519BEF0709EF62F42 "Apple Development: dev@example.com (YR2FG95T5F)"
  2) 19395BCCE5C379E161FB8FDDD44C87530C7EEA7B "Apple Distribution: Example Co. (F47G63A8DM)"
  3) 5BD16ECAAEC87E29308E3F6ED4D75B53234E0B9F "Developer ID Application: Example Co. (F47G63A8DM)"
     3 valid identities found
`;

test('parseDeveloperIdIdentities keeps only Developer ID Application', () => {
  assert.deepEqual(parseDeveloperIdIdentities(FIND_IDENTITY), [
    'Developer ID Application: Example Co. (F47G63A8DM)',
  ]);
  assert.deepEqual(parseDeveloperIdIdentities('     0 valid identities found\n'), []);
});

test('resolveSigningIdentity prefers the env, then a single keychain identity', () => {
  assert.deepEqual(
    resolveSigningIdentity({ envIdentity: ' Custom ', findIdentityOutput: () => FIND_IDENTITY }),
    { kind: 'env', identity: 'Custom' },
  );
  assert.deepEqual(
    resolveSigningIdentity({ envIdentity: '', findIdentityOutput: () => FIND_IDENTITY }),
    { kind: 'keychain', identity: 'Developer ID Application: Example Co. (F47G63A8DM)' },
  );
  assert.deepEqual(resolveSigningIdentity({ envIdentity: undefined, findIdentityOutput: () => '' }), {
    kind: 'none',
  });
  const two = `${FIND_IDENTITY}  4) 0000000000000000000000000000000000000000 "Developer ID Application: Other (AAAAAAAAAA)"\n`;
  assert.equal(
    resolveSigningIdentity({ envIdentity: undefined, findIdentityOutput: () => two }).kind,
    'ambiguous',
  );
});
