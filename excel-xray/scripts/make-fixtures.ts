import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_FIXTURES } from './fixtures-lib';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
mkdirSync(dir, { recursive: true });
for (const [name, build] of Object.entries(ALL_FIXTURES)) {
  const buf = await build();
  writeFileSync(join(dir, `${name}.xlsx`), buf);
  console.log(`${name}.xlsx  ${(buf.length / 1024).toFixed(1)} KB`);
}
