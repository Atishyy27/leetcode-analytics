// Runs every suite in its own process, so one module blowing up at load time
// cannot take the others' results with it.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.cjs")).sort();
let failed = 0;

for (const f of files) {
  try {
    process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, f)], { encoding: "utf8" }));
  } catch (err) {
    failed++;
    process.stdout.write(err.stdout || "");
    process.stdout.write(err.stderr || "");
  }
}

console.log(failed === 0 ? `\nALL PASS  ${files.length} suites` : `\n${failed} of ${files.length} suites FAILED`);
process.exit(failed === 0 ? 0 : 1);
