let pass = 0, fail = 0; const failures = [];
export async function test(name, fn) {
  try { await fn(); pass++; console.log(`  PASS  ${name}`); }
  catch (e) { fail++; failures.push(name); console.log(`  FAIL  ${name}\n        ${String(e.stack || e).split('\n').slice(0, 4).join('\n        ')}`); }
}
export function summary(label) {
  console.log(`\n[${label}] ${pass + fail}件中 ${pass}件 PASS / ${fail}件 FAIL`);
  if (fail) console.log('FAILED: ' + failures.join(', '));
  console.log(`RESULT ${label} total=${pass + fail} pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
}
