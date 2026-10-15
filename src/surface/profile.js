/**
 * The profile panel: everything the old extension did, and the things it
 * could not do because it never had the full problem set in hand.
 *
 * The shape of the work is: fetch the problem list once and cache it, join it
 * to the shipped rating table, then compute locally. After the first sync a
 * profile view costs zero requests, which is the difference between an
 * extension you leave installed and one you uninstall after a week.
 */
(function (root) {
  "use strict";
  const LCA = (root.LCA = root.LCA || {});
  const { el, card, stat, svgBox, link, waitForAnchor, tabs, download, fmt, pct } = LCA.ui;

  const UNIVERSE_TTL = 12 * 60 * 60 * 1000;
  const RECENT_TTL = 30 * 60 * 1000;
  const CONTEST_TTL = 6 * 60 * 60 * 1000;
  const PANEL_ID = "lca-panel";

  /**
   * Where to put the panel.
   *
   * Four strategies, tried in order, because LeetCode's profile markup is
   * generated Tailwind and changes between builds. The first one that finds a
   * node wins, and which one won is logged, so when a future build breaks
   * strategy 1 the console says "attached via strategy 3" instead of nothing.
   */
  function anchors() {
    return [
      // 1. The main column on the profile, found by its own width class.
      () => document.querySelector('[class*="lc-lg:max-w-["]'),
      // 2. The column that holds the recent-submissions card, walked up to a
      //    block-level parent wide enough to hold a chart.
      () => {
        const head = Array.from(document.querySelectorAll("div,section")).find((n) => {
          const t = (n.textContent || "").trim();
          return t.startsWith("Recent AC") || t.startsWith("Solved Problems") || t.startsWith("Community Stats");
        });
        let n = head;
        for (let i = 0; n && i < 6; i++) {
          if (n.getBoundingClientRect().width > 480) return n.parentElement || n;
          n = n.parentElement;
        }
        return null;
      },
      // 3. The widest direct descendant of the app root.
      () => {
        const roots = document.querySelectorAll("#__next > div > div, main");
        let best = null;
        let bestW = 0;
        for (const r of roots) {
          const w = r.getBoundingClientRect().width;
          if (w > bestW) {
            bestW = w;
            best = r;
          }
        }
        return bestW > 480 ? best : null;
      },
      // 4. Give up gracefully and own a strip at the end of the body, rather
      //    than rendering nothing at all.
      () => document.body,
    ];
  }

  function skeleton() {
    const statusText = el("span", { class: "lca-status-text", text: "Starting up" });
    const bar = el("div", { class: "lca-progress-fill" });
    const progress = el("div", { class: "lca-progress" }, [bar]);
    const status = el("div", { class: "lca-status" }, [el("span", { class: "lca-spinner" }), statusText, progress]);
    const body = el("div", { class: "lca-body" });

    const panel = el("section", { class: "lca-panel", id: PANEL_ID }, [
      el("header", { class: "lca-head" }, [
        el("h2", { class: "lca-title", text: "Rating Analytics" }),
        el("span", { class: "lca-badge", text: "v2" }),
      ]),
      status,
      body,
    ]);

    return {
      panel: panel,
      body: body,
      say: (msg) => {
        statusText.textContent = msg;
      },
      progress: (done, total) => {
        progress.classList.add("is-on");
        bar.style.width = total ? Math.round((done / total) * 100) + "%" : "0%";
      },
      done: () => status.remove(),
      fail: (msg) => {
        status.textContent = "";
        status.appendChild(el("p", { class: "lca-error", text: msg }));
      },
    };
  }

  async function cachedUniverse(me, ui, signal, force) {
    const key = "universe:" + me;
    if (!force) {
      const hit = await LCA.store.get(key);
      if (hit && hit.value) {
        const rows = LCA.pack.unpack(hit.value);
        if (rows) return { rows: rows, at: hit.at, fresh: false };
      }
    }

    ui.say("Reading your problem list from LeetCode");
    const rows = await LCA.gql.fetchUniverse((d, t) => {
      ui.progress(d, t);
      ui.say(`Reading your problem list (${d} of ${t} pages)`);
    }, signal);

    await LCA.store.set(key, LCA.pack.pack(rows, { me: me }), UNIVERSE_TTL);
    return { rows: rows, at: Date.now(), fresh: true };
  }

  function overviewTab(ctx) {
    const { joined, curve, crossover, summary, slots, table, universeAt } = ctx;

    const tiles = el("div", { class: "lca-stats" }, [
      stat("rated solves", fmt(joined.ratedSolved), `of ${fmt(joined.ratedTotal)} rated problems`),
      stat("half-solved at", crossover ? fmt(crossover) : "—", "where your coverage crosses 50%"),
      stat("top-10 mean", summary.top10 ? fmt(summary.top10) : "—", "mean of your 10 hardest"),
      stat("hardest", summary.max ? fmt(summary.max) : "—", "single hardest solved"),
    ]);

    const slotBars = slots.map((s) => ({
      label: s.slot,
      value: s.rate === null ? 0 : s.rate * 100,
      note: `${s.solved}/${s.total}`,
      title: `${s.slot}: solved ${s.solved} of ${s.total}`,
    }));

    return el("div", {}, [
      tiles,
      card(
        "Coverage by rating band",
        "Bars are how many you solved. The line is what share of that band exists and is done.",
        svgBox(LCA.svg.coverageChart(curve, { crossover: crossover }))
      ),
      card(
        "Contest slots",
        "Q1 and Q2 are warm-ups, Q4 decides contest rating. The split says whether topics or the clock is the limit.",
        svgBox(LCA.svg.hbars(slotBars, { labelW: 48, width: 560 }))
      ),
      el("p", { class: "lca-note" }, [
        `${fmt(joined.unratedSolved)} of your solves are not in the rating table at all, because they never appeared in a contest. They are excluded from every number above. Rating snapshot ${table.snapshot}, ${fmt(table.count)} problems, ${table.source}. Problem list read ${ago(universeAt)}.`,
      ]),
    ]);
  }

  function topicsTab(ctx) {
    const { matrix, weak } = ctx;

    const bars = weak.slice(0, 12).map((w) => ({
      label: w.topic,
      value: w.deficit,
      note: `${w.solved}/${w.total}`,
      title: `${w.topic}: solved ${w.solved} of ${w.total}, ${w.expected.toFixed(1)} expected at your coverage`,
    }));

    return el("div", {}, [
      card(
        "Topic by rating band",
        "Darker is a larger share of that topic solved in that band. Hollow means the band holds no problems with that tag.",
        svgBox(LCA.svg.heatmap(matrix))
      ),
      card(
        "Behind for someone who solves what you solve",
        "Measured against your own band-by-band coverage, not against other people. Positive bars are topics where you are short.",
        svgBox(LCA.svg.hbars(bars, { labelW: 170, width: 620, empty: "Not enough tagged problems yet." }))
      ),
    ]);
  }

  function nextTab(ctx) {
    const { universe, weak, crossover, summary, settings } = ctx;

    const base = crossover || summary.median || 1500;
    let offset = settings.targetOffset;

    const list = el("div", { class: "lca-reco" });
    const label = el("span", { class: "lca-target-value" });

    function paint() {
      const target = Math.round(base + offset);
      label.textContent = String(target);
      const picks = LCA.analysis.recommend(universe, { target: target, weakTopics: weak, count: 12 });
      list.textContent = "";
      if (picks.length === 0) {
        list.appendChild(el("p", { class: "lca-note", text: "Nothing unsolved in that window. Push the target up." }));
        return;
      }
      for (const p of picks) {
        list.appendChild(
          el("div", { class: "lca-reco-row" }, [
            el("span", { class: "lca-reco-rating", text: String(p.rating) }),
            link("https://leetcode.com/problems/" + p.slug + "/", p.title, "lca-reco-title"),
            el("span", { class: "lca-reco-tags", text: (p.tags || []).slice(0, 3).join(" · ") }),
            el("span", { class: "lca-reco-slot", text: p.index || "" }),
          ])
        );
      }
    }

    function bump(d) {
      offset = Math.max(-300, Math.min(600, offset + d));
      LCA.store.setSettings({ targetOffset: offset });
      paint();
    }

    const controls = el("div", { class: "lca-target" }, [
      el("span", { text: "target" }),
      el("button", { class: "lca-btn", type: "button", text: "−50", onclick: () => bump(-50) }),
      label,
      el("button", { class: "lca-btn", type: "button", text: "+50", onclick: () => bump(50) }),
      el("span", { class: "lca-note-inline", text: `base ${Math.round(base)} from your coverage` }),
    ]);

    paint();

    return el("div", {}, [
      card(
        "What to solve next",
        "Unsolved, free, just above where your coverage breaks down, weighted towards topics you are behind on. No model, just the table.",
        el("div", {}, [controls, list])
      ),
    ]);
  }

  function recentTab(ctx) {
    const { recent, summary } = ctx;
    if (!recent || recent.items.length === 0) {
      return card("Recent solves", null, el("p", { class: "lca-note", text: "LeetCode returned no recent accepted submissions for this profile." }));
    }

    const pts = recent.items.map((i) => ({ t: i.solvedAt, rating: i.rating, title: i.title, slug: i.slug }));
    const times = pts.map((p) => p.t);
    const from = new Date(Math.min.apply(null, times) * 1000).toISOString().slice(0, 10);
    const to = new Date(Math.max.apply(null, times) * 1000).toISOString().slice(0, 10);

    const queue = LCA.analysis.revisionQueue(recent.items, Math.floor(Date.now() / 1000), {
      level: summary ? summary.median : null,
      count: 8,
    });

    const rows = queue.map((q) =>
      el("div", { class: "lca-reco-row" }, [
        el("span", { class: "lca-reco-rating", text: String(q.rating) }),
        link("https://leetcode.com/problems/" + q.slug + "/", q.title, "lca-reco-title"),
        el("span", { class: "lca-reco-tags", text: Math.round(q.days) + " days ago" }),
      ])
    );

    return el("div", {}, [
      card(
        "Recent accepted, by rating",
        `One dot per solve. The line is a least-squares fit, not a path. ${recent.unmatched} recent solves had no community rating and are not plotted.`,
        svgBox(LCA.svg.scatterOverTime(pts, { fromLabel: from, toLabel: to }))
      ),
      card(
        "Probably forgotten",
        "Old solves weighted by how far above your own median they were. This is staleness, not a review history: nothing here knows whether you actually revisited one.",
        rows.length ? el("div", { class: "lca-reco" }, rows) : el("p", { class: "lca-note", text: "Nothing older than three weeks in the recent window." })
      ),
    ]);
  }

  function contestTab(ctx) {
    const { contest, summary, crossover } = ctx;
    if (!contest) {
      return card("Contest", null, el("p", { class: "lca-note", text: "No contest record on this profile." }));
    }

    const practice = crossover || (summary ? summary.top10 : null);
    const cal = LCA.analysis.calibration(practice, contest.rating);

    return el("div", {}, [
      el("div", { class: "lca-stats" }, [
        stat("contest rating", fmt(contest.rating), `${fmt(contest.attendedContestsCount)} contests`),
        stat("practice level", practice ? fmt(practice) : "—", "from coverage, not contests"),
        stat("gap", cal.gap === null ? "—" : (cal.gap > 0 ? "+" : "") + fmt(cal.gap), "practice minus contest"),
        stat("global rank", fmt(contest.globalRanking), contest.topPercentage ? "top " + contest.topPercentage.toFixed(1) + "%" : ""),
      ]),
      cal.reading ? el("p", { class: "lca-note", text: cal.reading }) : null,
    ]);
  }

  function dataTab(ctx, rerun) {
    const { joined, table, universeAt, me } = ctx;
    const bytesLine = el("span", { class: "lca-note-inline", text: "measuring cache…" });
    LCA.store.bytes().then((b) => {
      bytesLine.textContent = b === null ? "cache size unavailable" : `cache holds ${(b / 1024).toFixed(0)}K`;
    });

    return el("div", {}, [
      card(
        "Where these numbers come from",
        null,
        el("div", { class: "lca-kv" }, [
          kv("rating table", `${fmt(table.count)} problems, snapshot ${table.snapshot}, ${table.source}`),
          kv("problem list", `${fmt(joined.ratedTotal + joined.unratedTotal)} problems, read ${ago(universeAt)}`),
          kv("rated / unrated", `${fmt(joined.ratedTotal)} rated, ${fmt(joined.unratedTotal)} never in a contest`),
          kv("your solves", `${fmt(joined.ratedSolved)} rated, ${fmt(joined.unratedSolved)} unrated`),
          kv("account", me),
        ])
      ),
      card(
        "Take it with you",
        "Both run entirely in this tab. Nothing is uploaded anywhere.",
        el("div", { class: "lca-row" }, [
          el("button", {
            class: "lca-btn",
            type: "button",
            text: "Export CSV",
            onclick: () => download(`leetcode-${me}-${new Date().toISOString().slice(0, 10)}.csv`, LCA.join.toCsv(ctx.universe), "text/csv"),
          }),
          el("button", {
            class: "lca-btn",
            type: "button",
            text: "Export JSON",
            onclick: () =>
              download(
                `leetcode-${me}-${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify({ user: me, snapshot: table.snapshot, generated: new Date().toISOString(), problems: ctx.universe }, null, 1),
                "application/json"
              ),
          }),
          el("button", { class: "lca-btn", type: "button", text: "Re-sync now", onclick: () => rerun(true) }),
          bytesLine,
        ])
      ),
    ]);
  }

  function kv(k, v) {
    return el("div", { class: "lca-kv-row" }, [el("span", { class: "lca-kv-k", text: k }), el("span", { class: "lca-kv-v", text: String(v) })]);
  }

  function ago(ts) {
    if (!Number.isFinite(ts)) return "just now";
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " minutes ago";
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return hrs + " hours ago";
    return Math.round(hrs / 24) + " days ago";
  }

  /** Someone else's profile: say plainly how little is knowable. */
  function foreignView(ctx) {
    return el("div", {}, [
      el("p", { class: "lca-note" }, [
        `This is not your profile. LeetCode will only return another account's twenty most recent accepted submissions, so coverage, topics and recommendations are not computable here. What follows is those solves, rated.`,
      ]),
      recentTab(ctx),
      ctx.contest ? contestTab(ctx) : null,
    ]);
  }

  async function run(username, signal) {
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();

    const settings = await LCA.store.getSettings();
    if (!settings.onProfile) return;

    const found = await waitForAnchor(anchors(), 12000);
    if (!found) {
      console.warn("[LCA] no anchor on this profile page, nothing rendered");
      return;
    }
    console.log("[LCA] attached via strategy", found.strategy + 1);

    const ui = skeleton();
    LCA.theme.bind(ui.panel);
    found.node.appendChild(ui.panel);

    async function build(force) {
      ui.body.textContent = "";
      try {
        ui.say("Loading the rating table");
        const table = await LCA.data.load();

        ui.say("Checking who you are signed in as");
        const me = await LCA.gql.whoAmI(signal);
        const own = !!me && me.toLowerCase() === username.toLowerCase();

        const recentRaw = await withCache("recent:" + username, RECENT_TTL, () => LCA.gql.fetchRecent(username, 20, signal), force);
        const recent = LCA.join.fromRecent(recentRaw || [], table.bySlug);
        const contest = await withCache("contest:" + username, CONTEST_TTL, () => LCA.gql.fetchContest(username, signal), force);

        if (!own) {
          ui.done();
          ui.body.appendChild(foreignView({ recent: recent, contest: contest, summary: null, crossover: null, table: table }));
          return;
        }

        const uni = await cachedUniverse(me, ui, signal, force);
        const joined = LCA.join.build(uni.rows, table.bySlug);
        const universe = joined.universe;

        const solvedRatings = universe.filter((p) => p.solved).map((p) => p.rating);
        const summary = LCA.ratings.summarise(solvedRatings);
        const curve = LCA.analysis.coverageCurve(universe, settings.bucket);
        const crossover = LCA.analysis.crossoverRating(curve, 0.5);
        const weak = LCA.analysis.weakTopics(universe, settings.bucket);
        const matrix = LCA.analysis.topicMatrix(universe, settings.bucket);
        const slots = LCA.analysis.slotCoverage(universe);

        // Hand the level to the problem-page chip. It runs on pages that have
        // no reason to sync the whole problem list, so without this it can
        // only say "1711" and not "1711, above where you are".
        if (Number.isFinite(crossover)) {
          await LCA.store.set("level", Math.round(crossover), UNIVERSE_TTL);
        }

        const ctx = {
          me: me,
          universe: universe,
          joined: joined,
          summary: summary,
          curve: curve,
          crossover: crossover,
          weak: weak,
          matrix: matrix,
          slots: slots,
          recent: recent,
          contest: contest,
          table: table,
          universeAt: uni.at,
          settings: settings,
        };

        ui.done();
        const t = tabs([
          { name: "overview", label: "Overview", build: () => overviewTab(ctx) },
          { name: "topics", label: "Topics", build: () => topicsTab(ctx) },
          { name: "next", label: "Next up", build: () => nextTab(ctx) },
          { name: "recent", label: "Recent", build: () => recentTab(ctx) },
          { name: "contest", label: "Contest", build: () => contestTab(ctx) },
          { name: "data", label: "Data", build: () => dataTab(ctx, build) },
        ]);
        ui.body.appendChild(t.strip);
        ui.body.appendChild(t.body);
      } catch (err) {
        if (err && err.name === "AbortError") return;
        console.error("[LCA]", err);
        ui.fail(err.message || String(err));
      }
    }

    await build(false);
  }

  async function withCache(key, ttl, fn, force) {
    if (!force) {
      const hit = await LCA.store.get(key);
      if (hit) return hit.value;
    }
    const value = await fn();
    await LCA.store.set(key, value, ttl);
    return value;
  }

  LCA.profile = { run: run, PANEL_ID: PANEL_ID };
})(typeof globalThis !== "undefined" ? globalThis : self);
