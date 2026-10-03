import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanIp, subnetOf } from '../src/lib/ip.js';
import { leadingZeroBits, safeEqual } from '../src/lib/hash.js';

test('cleanIp unwraps ipv4 in ipv6', () => assert.equal(cleanIp('::ffff:10.1.2.3'), '10.1.2.3'));
test('cleanIp rejects junk', () => { for (const bad of [null, '', 'abc', '999.1.1.1', '1.2.3']) assert.equal(cleanIp(bad), null, String(bad)); });
test('ipv4 subnet is the /24', () => assert.equal(subnetOf('192.168.7.200'), '192.168.7.0/24'));
test('same /24 shares a subnet, different /24 does not', () => {
  assert.equal(subnetOf('10.0.0.1'), subnetOf('10.0.0.254'));
  assert.notEqual(subnetOf('10.0.0.1'), subnetOf('10.0.1.1'));
});
test('ipv6 subnet is the /64 and expands ::', () => {
  assert.equal(subnetOf('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(subnetOf('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(subnetOf('2001:DB8:0001::5'), subnetOf('2001:db8:1::9'));
});

test('leadingZeroBits counts across bytes', () => {
  assert.equal(leadingZeroBits(Buffer.from([0xff])), 0);
  assert.equal(leadingZeroBits(Buffer.from([0x0f])), 4);
  assert.equal(leadingZeroBits(Buffer.from([0x00, 0x80])), 8);
  assert.equal(leadingZeroBits(Buffer.from([0x00, 0x00, 0x01])), 23);
});
test('safeEqual', () => { assert.ok(safeEqual('abc', 'abc')); assert.ok(!safeEqual('abc', 'abd')); assert.ok(!safeEqual('abc', 'abcd')); });
