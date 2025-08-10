// --- v1.0.0 ---
// Final working version using the user-provided stable selector.

const LOG_PREFIX = "[LC-Analytics]";

console.log(`${LOG_PREFIX} v1.0.0 Script loaded. Polling for injection point...`);

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

/**
 * Injects the main UI container using the user-provided selector.
 * @returns {HTMLElement|null} The injected container or null on failure.
 */
function injectContainer() {
    console.log(`${LOG_PREFIX} Attempting to find the user-provided injection point.`);
    
    // Use the exact selector you found!
    const INJECTION_SELECTOR = "#__next > div > div > div > div.lc-lg\\:max-w-\\[calc\\(100\\%_-_316px\\)\\].w-full";
    const injectionPoint = document.querySelector(INJECTION_SELECTOR);

    if (!injectionPoint) {
        console.log(`${LOG_PREFIX} Could not find the injection point with the provided selector yet.`);
        return null;
    }
    console.log(`${LOG_PREFIX} Found stable injection point!`, injectionPoint);

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
    
    // Safest Method: Append to the end of the container.
    injectionPoint.appendChild(container);
    console.log(`${LOG_PREFIX} Successfully injected UI container.`);
    return container;
}


async function initializeData() {
    if (problemRatingsMap) return true;
    setLoadingState(true, 'Initializing rating database...');
    try {
        const response = await fetch('https://raw.githubusercontent.com/zerotrac/leetcode_problem_rating/main/data/data.json');
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const problems = await response.json();
        problemRatingsMap = new Map(problems.map(p => [p.title_slug, p]));
        console.log(`${LOG_PREFIX} Loaded and mapped ${problemRatingsMap.size} problem ratings.`);
        return true;
    } catch (error) {
        console.error(`${LOG_PREFIX} Failed to initialize rating data:`, error);
        setLoadingState(false, 'Error: Could not load rating database.');
        return false;
    }
}

async function startAnalytics(username) {
    setLoadingState(true, `Fetching submissions for ${username}...`);
    try {
        const solvedProblemSlugs = await fetchUserSubmissions_Mock(username);
        console.log(`${LOG_PREFIX} Fetched ${solvedProblemSlugs.length} mock submissions.`);

        const { ratedSolvedProblems, unratedCount } = processSubmissions(solvedProblemSlugs);
        const ratingDistribution = processRatingData(ratedSolvedProblems);
        const tagCounts = processTagData(ratedSolvedProblems);

        await loadScript('https://cdn.jsdelivr.net/npm/chart.js');
        console.log(`${LOG_PREFIX} Chart.js loaded. Rendering charts.`);
        
        updateRatingDistributionChart(ratingDistribution);
        updateTagsChart(tagCounts);
        updateSummaryStats(ratedSolvedProblems.length, unratedCount);
        
        const chartsEl = document.getElementById('lc-analytics-charts');
        if (chartsEl) chartsEl.style.display = 'grid';
        setLoadingState(false);

    } catch (error) {
        console.error(`${LOG_PREFIX} Error during analytics process:`, error);
        setLoadingState(false, `Error: ${error.message}`);
    }
}

// --- Data Processing & Charting (No Changes Needed) ---
function processSubmissions(slugs) { const ratedSolvedProblems = []; let unratedCount = 0; for (const slug of new Set(slugs)) { if (problemRatingsMap.has(slug)) { ratedSolvedProblems.push(problemRatingsMap.get(slug)); } else { unratedCount++; } } return { ratedSolvedProblems, unratedCount }; }
function processRatingData(submissions) { const ratingCounts = {}; submissions.forEach(sub => { const bracket = Math.floor(sub.rating / 100) * 100; ratingCounts[bracket] = (ratingCounts[bracket] || 0) + 1; }); const sortedBrackets = Object.keys(ratingCounts).sort((a, b) => a - b); return { labels: sortedBrackets.map(bracket => `${bracket}`), data: sortedBrackets.map(bracket => ratingCounts[bracket]) }; }
function processTagData(submissions) { const tagCounts = {}; submissions.forEach(sub => sub.tags.forEach(tag => tagCounts[tag] = (tagCounts[tag] || 0) + 1)); const sortedTags = Object.entries(tagCounts).sort(([, a], [, b]) => b - a).slice(0, 15); return { labels: sortedTags.map(entry => entry[0]), data: sortedTags.map(entry => entry[1]), backgroundColors: sortedTags.map((_, i) => `hsl(${(i * 40) % 360}, 65%, 55%)`) }; }
function updateRatingDistributionChart({ labels, data }) { if (!document.getElementById('ratingDistributionChart')) return; const ctx = document.getElementById('ratingDistributionChart').getContext('2d'); if (ratingDistributionChart) ratingDistributionChart.destroy(); ratingDistributionChart = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: 'Problems Solved', data, backgroundColor: 'rgba(245, 166, 35, 0.7)', borderColor: 'rgba(245, 166, 35, 1)', borderWidth: 1 }] }, options: { scales: { y: { beginAtZero: true, ticks: { color: '#aaa' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } }, x: { ticks: { color: '#aaa' }, grid: { display: false } } }, plugins: { legend: { display: false } } } }); }
function updateTagsChart({ labels, data, backgroundColors }) { if (!document.getElementById('tagsChart')) return; const ctx = document.getElementById('tagsChart').getContext('2d'); if (tagsChart) tagsChart.destroy(); tagsChart = new Chart(ctx, { type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: backgroundColors, hoverOffset: 4, borderColor: '#1a1a1a' }] }, options: { responsive: true, plugins: { legend: { position: 'right', labels: { color: '#ddd', boxWidth: 12, padding: 10, font: { size: 11 } } } } } }); }
function setLoadingState(isLoading, message = '') { const statusEl = document.getElementById('lc-analytics-status'); if (!statusEl) return; if (isLoading) { statusEl.innerHTML = `<div class="lc-loader"></div><p style="margin-top: 8px;">${message}</p>`; } else { statusEl.innerHTML = `<p>${message}</p>`; } }
function updateSummaryStats(ratedCount, unratedCount) { const summaryEl = document.getElementById('lc-analytics-summary'); if (summaryEl) summaryEl.innerHTML = `<p>Showing analytics for <strong>${ratedCount}</strong> rated problems. <strong>${unratedCount}</strong> solved problems were not rated.</p>`; }
function loadScript(url) { return new Promise((resolve, reject) => { if (window.Chart) { resolve(); return; } const script = document.createElement('script'); script.src = url; script.onload = () => resolve(); script.onerror = () => reject(new Error(`Script load error for ${url}`)); document.head.appendChild(script); }); }

// --- Mock Data ---
async function fetchUserSubmissions_Mock(username) { await new Promise(resolve => setTimeout(resolve, 1500)); if (username.toLowerCase() === 'unknownuser') throw new Error("User 'unknownuser' not found."); return ['two-sum', 'add-two-numbers', 'longest-substring-without-repeating-characters', 'median-of-two-sorted-arrays', 'reverse-integer', 'container-with-most-water', '3sum', 'valid-parentheses', 'merge-k-sorted-lists', 'longest-valid-parentheses', 'search-in-rotated-sorted-array', 'trapping-rain-water', 'basic-calculator', 'find-first-and-last-position-of-element-in-sorted-array', 'reverse-string']; }


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
            console.error(`${LOG_PREFIX} Max attempts reached. Could not inject UI.`);
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
}).observe(document, {subtree: true, childList: true});

main();