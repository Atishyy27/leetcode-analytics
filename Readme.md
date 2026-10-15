# LeetCode Rating Analytics

LeetCode tells you a problem is "Medium". The community rating dataset knows it
was Q3 of weekly contest 106 and came out at 1711. This puts that number where
you are already looking: on your profile, on every problem page, and on every
row of the problem list.

Version 2 is a rewrite. What it does that v1 did not, and why, is below.

## What you get

**On your profile.** Coverage by rating band, which is the chart the whole
thing exists for: not how many problems you solved in each band, but what
share of the problems that exist in each band you have done. A raw count peaks
in the middle for everyone, because LeetCode has far more 1500s than 2500s.
Dividing by what is available leaves the actual shape of one person's ability,
and the point where that curve crosses 50% is a defensible answer to "what
rating am I".

Also: a topic by rating-band grid, the topics you are behind on measured
against your own coverage rather than against other people, contest slot
coverage (Q1 through Q4, which separates "my topics are weak" from "I never
finish a contest"), your recent solves plotted against time, a revision list,
your contest rating next to your practice level, and CSV or JSON export.

**On a problem page.** A chip next to the difficulty: rating, contest, slot,
and whether that sits above or below your own level.

**In the problem list.** The rating inline on every row, colour-banded.

## What it costs you

Nothing leaves your browser. There is no server, no analytics and no account.

A default install declares exactly one permission, `storage`. The rating
dataset ships inside the extension, so a fresh install makes **zero**
third-party requests. The only calls it ever makes are to leetcode.com's own
GraphQL endpoint, signed in as you, from a leetcode.com page, which is the
same call the site makes to draw its own problem list.

There is one optional extra: refreshing the rating dataset from GitHub weekly.
It is off, it asks for the host permission from the options page and never at
install, and the permission is re-checked on every single call so revoking it
at `chrome://extensions` stops the traffic immediately.

## Install

1. `chrome://extensions` (or `brave://extensions`)
2. Developer mode on
3. Load unpacked, select this folder
4. Open any LeetCode page

After changing code: reload with the circular arrow on the extension card,
then refresh the LeetCode tab.

## Develop

```
node test/run.cjs        all test suites
node tools/check.cjs     the build check, run before loading
node tools/build-data.cjs path/to/ratings.txt   refresh the bundled dataset
```

`tools/check.cjs` exists because of v1. Its manifest listed
`libs/chart.min.js` and the file on disk was `libs/chart.umd.min.js`, so
Chrome refused to load the extension and the repo as committed did not run at
all. The check verifies every file the manifest names exists, that every
module in `src/` is actually loaded by the manifest, that the permission list
has not grown, that the shipped dataset holds the rows it claims, and that no
CSS rule is unnamespaced enough to restyle leetcode.com itself.

## What changed from v1, and why

**It loads.** See above.

**The cookie plumbing is gone, and the `cookies` permission with it.** v1
asked the service worker for `LEETCODE_SESSION` and `csrftoken`, then set a
`Cookie` header on fetch. `Cookie` is a forbidden header name: the browser
strips it silently. The requests worked anyway, because `credentials:
"include"` on a same-origin request already sends the real cookies. So the
entire pipeline, and the scariest permission in the manifest, did nothing.

**It no longer fires 74 simultaneous requests.** v1 paginated the whole
problem set 50 at a time inside one `Promise.all`. On a 3,700 problem set that
is about 74 concurrent POSTs to an endpoint that rate limits, and the first
429 threw a `TypeError` because the response was read without a check. v2 uses
pages of 100, three at a time, with exponential backoff, `Retry-After`
support, and a shape check on every response.

**It caches.** v1 re-downloaded the dataset and re-walked the API on every
single profile view. v2 syncs once, keeps the result for 12 hours, and after
that a profile view costs zero requests.

**Public profiles are honest.** v1 fetched tags one problem at a time, up to
500 round trips, for data identical for every user on earth. It also claimed
"public profile mode" based on a condition that was almost never true. LeetCode
only returns another account's 20 most recent accepted submissions, so v2 says
exactly that and shows only what it can actually compute.

**Chart.js is gone.** 200K of UMD bundle loaded into every leetcode.com page,
including the problem editor, to draw two charts. v2 draws SVG by hand: no
dependency, themes for free because inline SVG inherits CSS custom properties,
and chart code that is a pure string function and therefore testable.

**It follows your theme.** v1 hardcoded a dark palette and painted a dark card
into the middle of LeetCode's light mode.

**Histograms have no holes.** v1 built its bands from the brackets that
happened to be present, so a band you have never solved vanished and the two
either side were drawn adjacent. A cliff looked like a smooth slope.

**`/problemset/all/` is no longer a user called "all".** v1 took the last path
segment as a username and excluded six reserved words.

## Data

Problem ratings come from
[zerotrac/leetcode_problem_rating](https://github.com/zerotrac/leetcode_problem_rating),
which fits a rating to each contest problem from contest results. Only
problems that appeared in a rated contest have one: about 2,600 of LeetCode's
~3,700. Everything else is counted and reported separately, never folded in
silently.

The bundled snapshot date is printed on the panel.
