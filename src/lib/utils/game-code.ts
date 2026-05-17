/**
 * Generates a random 4-character alphanumeric game code.
 * Uses only uppercase letters and digits, excluding ambiguous chars (0/O, 1/I/L).
 */
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateGameCode(length = 4): string {
  let code = '';
  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    code += CHARS[array[i] % CHARS.length];
  }
  return code;
}

/**
 * Generates a unique session token for anonymous players.
 */
export function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}
