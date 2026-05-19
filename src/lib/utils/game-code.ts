/**
 * Generates a random 4-digit numeric game code.
 * Uses only digits (0-9).
 */
const CHARS = '0123456789';

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
