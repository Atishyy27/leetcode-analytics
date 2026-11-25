// Browser tests against a mocked LeetCode page. Run in CI only (needs
// playwright and a browser): node test/e2e/run.cjs [outDir]
//
// A small server builds a fake LeetCode profile page that loads the extension's
// real content scripts, in the order manifest.json lists them, after
// test/e2e/mock.js has replaced chrome.* and fetch. Nothing here touches the
// network or a real account.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "docs", "review-2026-11-25", "shots"));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const cs = manifest.content_scripts[0];

const MIME = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".tsv": "text/plain" };

function page() {
  const scripts = ["/test/e2e/mock.js"].concat(cs.js.map((s) => "/" + s));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>mock leetcode</title>
${cs.css.map((c) => `<link rel="stylesheet" href="/${c}">`).join("\n")}
<style>body{margin:0;font-family:system-ui,sans-serif;background:#f7f8fa;color:#1a1a1a}
.mock-nav{height:48px;background:#fff;border-bottom:1px solid #ddd;padding:12px 16px;box-sizing:border-box}
.mock-main{max-width:1000px;margin:16px auto;padding:0 12px;box-sizing:border-box}</style></head>
<body><div class="mock-nav">mock LeetCode</div>
<div class="mock-main lc-lg:max-w-[1000px]"></div>
${scripts.map((s) => `<script src="${s}"></script>`).join("\n")}
</body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (/^\/u\/[^/]+\/?$/.test(url.pathname)) {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(page());
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

let passed = 0;
const failed = [];
function check(cond, what) {
  if (cond) passed++;
  else failed.push(what);
  console.log((cond ? "PASS  " : "FAIL  ") + what);
}

async function shot(locator, name) {
  fs.mkdirSync(OUT, { recursive: true });
  let file = path.join(OUT, name + ".png");
  await locator.screenshot({ path: file });
  if (fs.statSync(file).size > 300 * 1024) {
    fs.unlinkSync(file);
    file = path.join(OUT, name + ".jpg");
    await locator.screenshot({ path: file, type: "jpeg", quality: 70 });
  }
  check(fs.statSync(file).size <= 300 * 1024, `${path.basename(file)} is under 300 KB (${Math.round(fs.statSync(file).size / 1024)} KB)`);
}

const VIEWS = [
  { tag: "desktop", width: 1280, height: 900 },
  { tag: "360", width: 360, height: 740 },
];

(async () => {
  const { chromium } = require("playwright");
  await new Promise((r) => server.listen(4173, r));
  const base = "http://localhost:4173";
  const browser = await chromium.launch();

  async function open(view, scenario, user) {
    const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height } });
    const pg = await ctx.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    await pg.goto(`${base}/u/${user || "mockuser"}/?s=${scenario}`);
    return { ctx, pg, errors };
  }
  const panel = (pg) => pg.locator("#lca-panel");

  for (const view of VIEWS) {
    const t = view.tag;

    // --- signed out ---
    {
      const { ctx, pg, errors } = await open(view, "signedout");
      await pg.locator("#lca-panel .lca-note").first().waitFor({ timeout: 15000 });
      const text = await panel(pg).innerText();
      check(/not signed in to LeetCode/.test(text), `[${t}] signed out says you are not signed in`);
      check(!/This is not your profile/.test(text), `[${t}] signed out does not say "not your profile"`);
      check(errors.length === 0, `[${t}] signed out has no page errors ${errors.join("|")}`);
      await shot(panel(pg), `signed-out-${t}`);
      await ctx.close();
    }

    // --- lookup failed (HTTP 500 past the retries) ---
    {
      const { ctx, pg, errors } = await open(view, "error");
      await pg.locator("#lca-panel .lca-error").waitFor({ timeout: 20000 });
      const text = await panel(pg).innerText();
      check(/Could not check who is signed in/.test(text), `[${t}] a failed lookup says so`);
      check(!/This is not your profile/.test(text), `[${t}] a failed lookup does not say "not your profile"`);
      check((await pg.locator("#lca-panel button", { hasText: "Retry" }).count()) === 1, `[${t}] a Retry button is offered`);
      const box = await panel(pg).boundingBox();
      check(box.width <= view.width, `[${t}] error panel fits the viewport (${Math.round(box.width)} px)`);
      check(errors.length === 0, `[${t}] error state has no page errors ${errors.join("|")}`);
      await shot(panel(pg), `lookup-failed-${t}`);
      await ctx.close();
    }

    // --- network failure ---
    {
      const { ctx, pg } = await open(view, "neterr");
      await pg.locator("#lca-panel .lca-error").waitFor({ timeout: 20000 });
      check(/Failed to fetch/.test(await panel(pg).innerText()), `[${t}] a network failure carries its cause`);
      await ctx.close();
    }

    // --- failed, then Retry works ---
    {
      const { ctx, pg } = await open(view, "flaky");
      await pg.locator("#lca-panel .lca-error").waitFor({ timeout: 20000 });
      const before = await pg.evaluate(() => window.__calls.filter((c) => c === "globalData").length);
      check(before === 4, `[${t}] the lookup was tried 4 times before giving up (${before})`);
      await pg.locator("#lca-panel button", { hasText: "Retry" }).click();
      await pg.locator("#lca-panel .lca-tab").first().waitFor({ timeout: 20000 });
      const after = await pg.evaluate(() => window.__calls.filter((c) => c === "globalData").length);
      check(after === 5, `[${t}] one click on Retry makes one more lookup (${after})`);
      check(/rated solves/.test(await panel(pg).innerText()), `[${t}] after Retry the panel shows your numbers`);
      await ctx.close();
    }

    // --- slow response ---
    {
      const { ctx, pg } = await open(view, "slow");
      await pg.locator("#lca-panel .lca-spinner").waitFor({ timeout: 5000 });
      check(/Checking who you are signed in as/.test(await panel(pg).innerText()), `[${t}] a slow lookup shows the spinner and what it waits for`);
      await pg.locator("#lca-panel .lca-tab").first().waitFor({ timeout: 25000 });
      check(true, `[${t}] a slow lookup still ends in the panel`);
      await ctx.close();
    }

    // --- old ratings: the stale line ---
    {
      const { ctx, pg, errors } = await open(view, "ok-stale");
      await pg.locator("#lca-panel .lca-tab").first().waitFor({ timeout: 25000 });
      const line = pg.locator("#lca-panel .lca-stale");
      check((await line.count()) === 1, `[${t}] old ratings show the stale line`);
      check(/Ratings are \d+ days old/.test(await line.innerText()), `[${t}] the stale line says how old`);
      check(errors.length === 0, `[${t}] stale state has no page errors ${errors.join("|")}`);
      await shot(panel(pg), `ratings-stale-${t}`);
      await ctx.close();
    }

    // --- fresh ratings: no stale line ---
    {
      const { ctx, pg } = await open(view, "ok");
      await pg.locator("#lca-panel .lca-tab").first().waitFor({ timeout: 25000 });
      check((await pg.locator("#lca-panel .lca-stale").count()) === 0, `[${t}] fresh ratings show no stale line`);
      const tiles = await pg.locator("#lca-panel .lca-stat").first().innerText();
      check(/100/.test(tiles), `[${t}] first read counts 100 rated solves (${tiles.replace(/\n/g, " ")})`);
      await shot(panel(pg), `overview-fresh-${t}`);
      await ctx.close();
    }

    // --- new solves count without a resync (same browser context, so the cache survives) ---
    {
      const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height } });
      const pg = await ctx.newPage();
      await pg.goto(`${base}/u/mockuser/?s=solve1`);
      await pg.locator("#lca-panel .lca-tab").first().waitFor({ timeout: 25000 });
      const first = await pg.locator("#lca-panel .lca-stat").first().innerText();
      check(/100/.test(first), `[${t}] before: 100 rated solves`);
      const listCalls1 = await pg.evaluate(() => window.__calls.filter((c) => c === "problemsetQuestionList").length);
      check(listCalls1 === 4, `[${t}] the first sync reads the list (330 problems, 4 pages, got ${listCalls1})`);

      await pg.goto(`${base}/u/mockuser/?s=solve2`);
      await pg.locator("#lca-panel .lca-tab").first().waitFor({ timeout: 25000 });
      const second = await pg.locator("#lca-panel .lca-stat").first().innerText();
      check(/103/.test(second), `[${t}] after 3 new solves the panel says 103 (${second.replace(/\n/g, " ")})`);
      const calls2 = await pg.evaluate(() => window.__calls.slice());
      check(calls2.filter((c) => c === "problemsetQuestionList").length === 0, `[${t}] the second view does not re-read the list`);
      check(calls2.filter((c) => c === "recentAcSubmissions").length === 1, `[${t}] the second view makes one recent-solves request`);
      check(/3 newer solves came from your recent submissions/.test(await panel(pg).innerText()), `[${t}] the panel says where the 3 came from`);
      await shot(panel(pg), `new-solves-${t}`);
      await ctx.close();
    }
  }

  await browser.close();
  server.close();
  console.log(`\n${failed.length === 0 ? "ALL PASS" : failed.length + " FAILED"}  ${passed} checks passed`);
  for (const f of failed) console.log("   -  " + f);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
