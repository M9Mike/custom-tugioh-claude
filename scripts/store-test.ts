/** Checks that a pasted connection string is cleaned up the way we expect. */
import { normaliseMongoUri } from '../src/server/store';

const cases: [string, string, boolean][] = [
  ['mongodb+srv://u:abc123@h.net/?x=1', 'mongodb+srv://u:abc123@h.net/?x=1', false],
  ['mongodb+srv://u:abc123 @h.net/?x=1', 'mongodb+srv://u:abc123@h.net/?x=1', true],
  ['mongodb+srv://u: abc123@h.net/?x=1', 'mongodb+srv://u:abc123@h.net/?x=1', true],
  ['  mongodb+srv://u:abc123@h.net/  ', 'mongodb+srv://u:abc123@h.net/', false],
  ['"mongodb+srv://u:abc123@h.net/"', 'mongodb+srv://u:abc123@h.net/', false],
  // A password containing characters that need percent-encoding is left alone.
  ['mongodb+srv://u:a%40b @h.net/', 'mongodb+srv://u:a%40b @h.net/', false],
  // No credentials at all: untouched apart from trimming.
  ['mongodb://127.0.0.1:27099/', 'mongodb://127.0.0.1:27099/', false],
];

let bad = 0;
for (const [input, expected, expectTrim] of cases) {
  const got = normaliseMongoUri(input);
  const ok = got.uri === expected && got.trimmedPassword === expectTrim;
  if (!ok) bad += 1;
  console.log(`${ok ? '✅' : '❌'} ${JSON.stringify(input)} -> ${JSON.stringify(got.uri)} trimmed=${got.trimmedPassword}`);
}
console.log(bad ? `\n${bad} case(s) FAILED` : '\nAll normalisation cases pass.');
process.exit(bad ? 1 : 0);
