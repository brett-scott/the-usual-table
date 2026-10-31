import { expect, it } from 'vitest';
import { decodeRoomInvite, encodeRoomInvite, roomIdFromHash, shortRoomHash } from './invitations';

it('round-trips the entire 128-bit space, leading zeros and real room identifiers in 22 unambiguous characters', () => {
  const ids = ['0'.repeat(32), 'f'.repeat(32), '0'.repeat(31) + '1', ...Array.from({ length: 64 }, () => crypto.randomUUID().replaceAll('-', ''))];
  const codes = ids.map(id => {
    const code = encodeRoomInvite(id);
    expect(code).toMatch(/^[1-9A-HJ-NP-Za-km-z]{22}$/);
    expect(decodeRoomInvite(code)).toBe(id); expect(roomIdFromHash(shortRoomHash(id))).toBe(id);
    expect(roomIdFromHash(`#/room/${id}`)).toBe(id); return code;
  });
  expect(new Set(codes).size).toBe(ids.length);
});
it.each(['', '1'.repeat(21), '1'.repeat(23), 'z'.repeat(22), '0'.repeat(22), 'O'.repeat(22), 'l'.repeat(22), '/'.repeat(22)])('rejects malformed or out-of-range invitation codes %s', code => {
  expect(decodeRoomInvite(code)).toBeNull(); expect(roomIdFromHash(`#/t/${code}`)).toBeNull();
});
it('does not accept noncanonical route suffixes, embedded URLs or invalid internal IDs', () => {
  const hash = shortRoomHash('a'.repeat(32));
  for (const invalid of [hash + '/extra', hash + '?accountId=other', '#/room/' + 'A'.repeat(32), 'https://other.test/' + hash]) expect(roomIdFromHash(invalid)).toBeNull();
  expect(() => encodeRoomInvite('wrong')).toThrow();
});
