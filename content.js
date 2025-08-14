// --- Refined LeetCode Analytics v1.1.0 ---
// Final version with real API call to fetch user submissions.

const LOG_PREFIX = "[LC-Analytics]";
console.log(`${LOG_PREFIX} v1.1.0 Script loaded. Polling for injection point...`);

// --- Global State ---
let problemRatingsMap = null;
let ratingDistributionChart = null;
let tagsChart = null;

// --- Core Functions ---
function getUsername() {
    const pathParts = window.location.pathname.split('/').filter(part => part.trim() !== '');
    if (pathParts.length > 0) {
        const potentialUsername = pathParts[pathParts.length - 1];
        if (potentialUsername && !['problems', 'contest', 'discuss', 'interview', 'submissions'].includes(potentialUsername)) {
            return potentialUsername;
        }
    }
    return null;
}

function injectContainer() {
    const INJECTION_SELECTOR = "#__next > div > div > div > div.lc-lg\\:max-w-\\[calc\\(100\\%_-_316px\\)\\].w-full";
    const injectionPoint = document.querySelector(INJECTION_SELECTOR);
    if (!injectionPoint) {
        console.log("Analytics: Could not find injection point.");
        return null;
    }
    const container = document.createElement('div');
    container.id = 'lc-analytics-container';
    container.innerHTML = `
        <h1>Rating Analytics</h1>
        <div id="lc-analytics-status"></div>
        <div id="lc-analytics-charts" style="display: none;">
            <div class="lc-chart-card">
                <h2>Problem Ratings</h2>
                <canvas id="ratingDistributionChart"></canvas>
            </div>
            <div class="lc-chart-card">
                <h2>Tags Solved</h2>
                <canvas id="tagsChart"></canvas>
            </div>
        </div>
        <div id="lc-analytics-summary"></div>
    `;
    injectionPoint.appendChild(container);
    return container;
}

async function initializeData() {
    if (problemRatingsMap) return true;
    setLoadingState(true, 'Initializing rating database...');

    try {
        console.log("[DEBUG] Fetching ratings from zerotrac GitHub...");
        const response = await fetch(
            "https://raw.githubusercontent.com/zerotrac/leetcode_problem_rating/main/ratings.txt"
        );
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

        const text = await response.text();
        const lines = text.trim().split("\n");
        const headers = lines[0].split(/\t+/); // tab-separated
        const problems = lines.slice(1).map(line => {
            const row = line.split(/\t+/);
            return Object.fromEntries(headers.map((h, i) => [h, row[i]]));
        });

        console.log("[DEBUG] problems length:", problems.length);
        console.log("[DEBUG] sample entry:", problems[0]);

        problemRatingsMap = new Map(
            problems.map(p => {
                const slug = (p["Title Slug"] || "").toLowerCase();
                return [slug, {
                    rating: parseFloat(p.Rating) || 0,
                    tags: [], // ratings.txt has no tags — keep empty or fetch tags separately
                    ...p
                }];
            }).filter(([slug]) => slug)
        );

        console.log("[DEBUG] problemRatingsMap size:", problemRatingsMap.size);
        return true;

    } catch (error) {
        console.error("Analytics: Failed to initialize rating data:", error);
        setLoadingState(false, 'Error: Could not load rating database.');
        return false;
    }
}

async function startAnalytics(username) {
    setLoadingState(true, `Fetching submissions for ${username}...`);
    try {
        const solvedProblemSlugs = await fetchUserSubmissions(username);
        const { ratedSolvedProblems, unratedCount } = processSubmissions(solvedProblemSlugs);
        const ratingDistribution = processRatingData(ratedSolvedProblems);
        const tagCounts = processTagData(ratedSolvedProblems);

        updateRatingDistributionChart(ratingDistribution);
        updateTagsChart(tagCounts);
        updateSummaryStats(ratedSolvedProblems.length, unratedCount);

        if (ratedSolvedProblems.length && unratedCount === 0 && username.toLowerCase() !== (await (await fetch("https://leetcode.com/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: "query { userStatus { username } }" }),
            credentials: "include"
        })).json()).data?.userStatus?.username?.toLowerCase()) {
            const summaryEl = document.getElementById('lc-analytics-summary');
            if (summaryEl) {
                summaryEl.innerHTML += `<p style="font-size: 12px; color: #888;">Public profile mode: Showing up to 500 recent problems only.</p>`;
            }
        }


        document.getElementById('lc-analytics-charts').style.display = 'grid';
        setLoadingState(false);
    } catch (error) {
        console.error(`${LOG_PREFIX} Error during analytics:`, error);
        setLoadingState(false, `Error: ${error.message}`);
    }
}

async function fetchUserSubmissions(username) {
    console.log("[DEBUG] Fetching solved problems...");

    // 1. Get cookies (only if logged in)
    const { session: sessionCookie, csrf: csrfCookie } = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: "GET_LEETCODE_COOKIES" }, resolve);
    });

    // Detect if this is *your own* profile
    let ownProfile = false;
    try {
        const meRes = await fetch("https://leetcode.com/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: "query { userStatus { username } }" }),
            credentials: "include"
        });
        const meJson = await meRes.json();
        ownProfile = meJson?.data?.userStatus?.username?.toLowerCase() === username.toLowerCase();
    } catch (_) { }

    // 2. If own profile and have cookies → fetch ALL via authenticated GraphQL
    if (ownProfile && sessionCookie && csrfCookie) {
        const query = `query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
            problemsetQuestionList: questionList(
                categorySlug: $categorySlug
                limit: $limit
                skip: $skip
                filters: $filters
            ) {
                total: totalNum
                questions: data {
                    titleSlug
                    status
                    difficulty
                    topicTags { name }
                }
            }
        }`;

        const firstRes = await fetch("https://leetcode.com/graphql", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Cookie": `LEETCODE_SESSION=${sessionCookie}; csrftoken=${csrfCookie}`,
                "x-csrftoken": csrfCookie
            },
            body: JSON.stringify({ query, variables: { categorySlug: "", skip: 0, limit: 50, filters: {} } }),
            credentials: "include"
        });
        const firstJson = await firstRes.json();
        const total = firstJson.data.problemsetQuestionList.total;
        const allSolved = firstJson.data.problemsetQuestionList.questions.filter(q => q.status === "ac");

        const promises = [];
        for (let skip = 50; skip < total; skip += 50) {
            promises.push(fetch("https://leetcode.com/graphql", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Cookie": `LEETCODE_SESSION=${sessionCookie}; csrftoken=${csrfCookie}`,
                    "x-csrftoken": csrfCookie
                },
                body: JSON.stringify({ query, variables: { categorySlug: "", skip, limit: 50, filters: {} } }),
                credentials: "include"
            }).then(r => r.json()));
        }

        const results = await Promise.all(promises);
        results.forEach(res => {
            allSolved.push(...res.data.problemsetQuestionList.questions.filter(q => q.status === "ac"));
        });

        console.log(`[DEBUG] Found ${allSolved.length} solved problems (own profile)`);
        return allSolved.map(q => ({
            titleSlug: q.titleSlug,
            topicTags: q.topicTags || [],
            difficulty: q.difficulty || "",
        }));
    }

    // 3. Public profile mode → fetch up to recent 500, with batched tag fetch
    console.log("[DEBUG] Fetching public profile data with batched details...");
    const publicQuery = `query recentAcSubmissions($username: String!, $limit: Int!) {
        recentAcSubmissionList(username: $username, limit: $limit) {
            titleSlug
        }
    }`;

    const pubRes = await fetch("https://leetcode.com/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: publicQuery, variables: { username, limit: 500 } })
    });
    const pubJson = await pubRes.json();
    const publicSolved = pubJson?.data?.recentAcSubmissionList || [];

    const detailQuery = `query questionData($titleSlug: String!) {
        question(titleSlug: $titleSlug) {
            difficulty
            topicTags { name }
        }
    }`;

    async function fetchOne(slug) {
        try {
            const res = await fetch("https://leetcode.com/graphql", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: detailQuery, variables: { titleSlug: slug } })
            });
            const json = await res.json();
            const q = json?.data?.question;
            return { titleSlug: slug, topicTags: q?.topicTags || [], difficulty: q?.difficulty || "" };
        } catch {
            return { titleSlug: slug, topicTags: [], difficulty: "" };
        }
    }

    const results = [];
    for (let i = 0; i < publicSolved.length; i += 10) {
        const batch = publicSolved.slice(i, i + 10).map(p => fetchOne(p.titleSlug));
        results.push(...(await Promise.all(batch)));
    }

    console.log(`[DEBUG] Found ${results.length} solved problems (public mode)`);
    return results;
}


// --- Data Processing & Charting ---
function processSubmissions(solvedProblems) {
    const ratedSolvedProblems = [];
    let unratedCount = 0;

    for (const problem of solvedProblems) {
        const slug = problem.titleSlug.toLowerCase();
        if (problemRatingsMap.has(slug)) {
            const baseData = problemRatingsMap.get(slug);
            ratedSolvedProblems.push({
                ...baseData,
                tags: problem.topicTags.map(t => t.name) // pull directly from GraphQL
            });
        } else {
            unratedCount++;
        }
    }
    return { ratedSolvedProblems, unratedCount };
}


function processRatingData(submissions) {
    const ratingCounts = {};
    submissions.forEach(sub => {
        const bracket = Math.floor(sub.rating / 100) * 100;
        ratingCounts[bracket] = (ratingCounts[bracket] || 0) + 1;
    });
    const sortedBrackets = Object.keys(ratingCounts).sort((a, b) => a - b);
    return {
        labels: sortedBrackets,
        data: sortedBrackets.map(b => ratingCounts[b] ?? 0)
    };
}

function processTagData(submissions) {
    const tagCounts = {};
    submissions.forEach(sub => {
        if (Array.isArray(sub.tags)) {
            sub.tags.forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
        }
    });
    const sortedTags = Object.entries(tagCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 15);
    return {
        labels: sortedTags.map(entry => entry[0]),
        data: sortedTags.map(entry => entry[1]),
        backgroundColors: sortedTags.map((_, i) =>
            `hsl(${(i * 40) % 360}, 65%, 55%)`
        )
    };
}


function updateRatingDistributionChart({ labels, data }) {
    if (!document.getElementById('ratingDistributionChart')) return;
    const ctx = document.getElementById('ratingDistributionChart').getContext('2d');
    if (ratingDistributionChart) ratingDistributionChart.destroy();
    ratingDistributionChart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Problems Solved', data, backgroundColor: 'rgba(245, 166, 35, 0.7)', borderColor: 'rgba(245, 166, 35, 1)', borderWidth: 1 }] },
        options: { scales: { y: { beginAtZero: true, ticks: { color: '#aaa' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } }, x: { ticks: { color: '#aaa' }, grid: { display: false } } }, plugins: { legend: { display: false } } }
    });
}

function updateTagsChart({ labels, data, backgroundColors }) {
    if (!document.getElementById('tagsChart')) return;
    const ctx = document.getElementById('tagsChart').getContext('2d');
    if (tagsChart) tagsChart.destroy();
    tagsChart = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: backgroundColors, hoverOffset: 4, borderColor: '#1a1a1a' }] },
        options: { responsive: true, plugins: { legend: { position: 'right', labels: { color: '#ddd', boxWidth: 12, padding: 10, font: { size: 11 } } } } }
    });
}

function setLoadingState(isLoading, message = '') {
    const statusEl = document.getElementById('lc-analytics-status');
    if (!statusEl) return;
    statusEl.innerHTML = isLoading ? `<div class="lc-loader"></div><p style="margin-top: 8px;">${message}</p>` : `<p>${message}</p>`;
}

function updateSummaryStats(ratedCount, unratedCount) {
    const summaryEl = document.getElementById('lc-analytics-summary');
    if (summaryEl) summaryEl.innerHTML = `<p>Showing analytics for <strong>${ratedCount}</strong> rated problems. <strong>${unratedCount}</strong> solved problems were not rated.</p>`;
}

// --- Entry Point ---
function main() {
    let attempts = 0;
    const maxAttempts = 20;
    const injectionInterval = setInterval(async () => {
        attempts++;
        const username = getUsername();
        if (document.getElementById('lc-analytics-container')) {
            clearInterval(injectionInterval);
            return;
        }
        if (username) {
            const container = injectContainer();
            if (container) {
                clearInterval(injectionInterval);
                const dataReady = await initializeData();
                if (dataReady) {
                    startAnalytics(username);
                }
            }
        }
        if (attempts >= maxAttempts) {
            clearInterval(injectionInterval);
        }
    }, 500);
}

let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        main();
    }
}).observe(document, { subtree: true, childList: true });

main();
// --- End of Refined LeetCode Analytics v1.1.0 ---
