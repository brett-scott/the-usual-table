// A reversible encoding retains the full 128-bit room identifier; no alias storage or weaker invitation secret.
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const limit = 1n << 128n;

export function encodeRoomInvite(roomId: string): string {
  if (!/^[a-f0-9]{32}$/.test(roomId)) throw new Error('Invalid room identifier');
  let value = BigInt(`0x${roomId}`); let code = '';
  while (value > 0n) { code = alphabet[Number(value % 58n)]! + code; value /= 58n; }
  return code.padStart(22, alphabet[0]!);
}
export function decodeRoomInvite(code: string): string | null {
  if (code.length !== 22) return null;
  let value = 0n;
  for (const char of code) {
    const digit = alphabet.indexOf(char); if (digit < 0) return null;
    value = value * 58n + BigInt(digit); if (value >= limit) return null;
  }
  return value.toString(16).padStart(32, '0');
}
export function roomIdFromHash(hash: string): string | null {
  const old = /^#\/room\/([a-f0-9]{32})$/.exec(hash); if (old) return old[1]!;
  const short = /^#\/t\/([^/]+)$/.exec(hash); return short ? decodeRoomInvite(short[1]!) : null;
}
export function shortRoomHash(roomId: string) { return `#/t/${encodeRoomInvite(roomId)}`; }
