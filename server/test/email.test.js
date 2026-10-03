import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseEmail, emailDomain } from '../src/lib/email.js';

test('lowercases and trims', () => assert.equal(normaliseEmail('  Asha@College.EDU '), 'asha@college.edu'));
test('drops plus tags', () => assert.equal(normaliseEmail('asha+drop@college.edu'), 'asha@college.edu'));
test('gmail dots do not make a new person', () => {
  assert.equal(normaliseEmail('a.s.h.a@gmail.com'), 'asha@gmail.com');
  assert.equal(normaliseEmail('asha@googlemail.com'), 'asha@gmail.com');
});
test('dots stay for non gmail domains', () => assert.equal(normaliseEmail('a.sha@college.edu'), 'a.sha@college.edu'));
test('gmail dots and plus together collapse to one account', () => {
  assert.equal(normaliseEmail('A.sha+x+y@Gmail.com'), normaliseEmail('asha@gmail.com'));
});
test('rejects malformed addresses', () => {
  for (const bad of ['', 'nope', '@x.com', 'a@', '+tag@x.com', '   ']) assert.equal(normaliseEmail(bad), null, bad);
});
test('domain helper', () => assert.equal(emailDomain('asha@college.edu'), 'college.edu'));
