// A test harness small enough that nobody has to trust it.
let pass = 0;
let fail = 0;
const failures = [];

function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { pass++; return; }
  fail++;
  failures.push(`${what}\n      expected ${b}\n      actual   ${a}`);
}

function near(actual, expected, tol, what) {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) { pass++; return; }
  fail++;
  failures.push(`${what}\n      expected ${expected} +/- ${tol}\n      actual   ${actual}`);
}

function ok(cond, what) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(what);
}

function report(name) {
  const total = pass + fail;
  if (fail === 0) {
    console.log(`PASS  ${name}: ${pass}/${total} assertions`);
  } else {
    console.log(`FAIL  ${name}: ${fail} of ${total} assertions failed`);
    for (const f of failures) console.log(`   -  ${f}`);
  }
  return fail;
}

module.exports = { eq, near, ok, report, counts: () => ({ pass, fail }) };
