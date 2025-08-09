console.log("LeetCode Analytics Script Loaded! v2");

// --- Main App Logic ---

const RATING_DATA_URL = 'https://raw.githubusercontent.com/zerotrac/leetcode_problem_rating/main/data/data.json';
let problemRatingsMap = null;
let ratingDistributionChart = null;
let tagsChart = null;

/**
 * Extracts the username from the LeetCode profile URL.
 */
function getUsernameFromURL() {
    const pathParts = window.location.pathname.split('/').filter(part => part);
    if (pathParts.length > 0) {
        // Handle URLs like /u/username/ or /username/
        const potentialUsername = pathParts[pathParts.length - 1];
        if (!['problems', 'contest', 'discuss', 'interview'].includes(potentialUsername)) {
            return potentialUsername;
        }
    }
    return null;
}

/**
 * Injects the main container for our analytics into the LeetCode page.
 * We will inject it right before the "Recent AC" section.
 */
function injectAnalyticsContainer() {
    // A more stable way to find the injection point is to look for the "Recent AC" section's parent.
    const recentAcElement = Array.from(document.querySelectorAll('div.text-label-1')).find(el => el.textContent.trim() === 'Recent AC');
    
    if (!recentAcElement) {
        console.error("Analytics: Could not find the 'Recent AC' section to inject content.");
        return null;
    }

    // Go up the DOM tree to find the container for the whole bottom section
    const injectionPoint = recentAcElement.closest('.mt-4.flex.w-full.flex-col');

    if (!injectionPoint) {
        console.error("Analytics: Could not find a valid parent element to inject the container.");
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

    // Insert our container *before* the recent submissions section
    injectionPoint.parentNode.insertBefore(container, injectionPoint);
    return container;
}

/**
 * Fetches the rating database.
 */
async function initializeRatingData() {
    setLoadingState(true, 'Initializing rating database...');
    try {
        const response = await fetch(RATING_DATA_URL);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const problems = await response.json();
        problemRatingsMap = new Map(problems.map(p => [p.title_slug, p]));
        console.log(`Successfully loaded and mapped ${problemRatingsMap.size} rated problems.`);
        setLoadingState(false);
        return true;
    } catch (error) {
        console.error("Failed to initialize problem rating data:", error);
        setLoadingState(false, 'Error: Could not load rating database.');
        return false;
    }
}

/**
 * Main function to fetch user data and render charts.
 */
async function handleFetch(username) {
    if (!problemRatingsMap) {
        console.error("Rating data is not loaded.");
        return;
    }

    setLoadingState(true, `Fetching submissions for ${username}...`);
    const chartsEl = document.getElementById('lc-analytics-charts');
    if(chartsEl) chartsEl.style.display = 'none';

    try {
        // MOCK FUNCTION - to be replaced with real API call
        const solvedProblemSlugs = await fetchUserSubmissions_Mock(username);

        let ratedSolvedProblems = [];
        let unratedCount = 0;

        for (const slug of new Set(solvedProblemSlugs)) {
            if (problemRatingsMap.has(slug)) {
                ratedSolvedProblems.push(problemRatingsMap.get(slug));
            } else {
                unratedCount++;
            }
        }

        const ratingDistribution = processRatingData(ratedSolvedProblems);
        const tagCounts = processTagData(ratedSolvedProblems);

        // Dynamically load Chart.js and then render
        await loadScript('https://cdn.jsdelivr.net/npm/chart.js');
        updateRatingDistributionChart(ratingDistribution);
        updateTagsChart(tagCounts);
        updateSummaryStats(ratedSolvedProblems.length, unratedCount);

        if(chartsEl) chartsEl.style.display = 'grid';

    } catch (error) {
        console.error("Error during fetch process:", error);
        setLoadingState(false, `Error: ${error.message}`);
    } finally {
        setLoadingState(false);
    }
}

async function fetchUserSubmissions_Mock(username) {
    console.log(`Fetching MOCK submission data for user: ${username}`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (username.toLowerCase() === 'unknownuser') {
        throw new Error("User 'unknownuser' not found.");
    }
    return [
        'two-sum', 'add-two-numbers', 'longest-substring-without-repeating-characters',
        'median-of-two-sorted-arrays', 'reverse-integer', 'container-with-most-water',
        '3sum', 'valid-parentheses', 'merge-k-sorted-lists', 'longest-valid-parentheses',
        'search-in-rotated-sorted-array', 'trapping-rain-water', 'basic-calculator',
        'find-first-and-last-position-of-element-in-sorted-array', 'reverse-string'
    ];
}

// --- Data Processing and Charting Functions ---

function processRatingData(submissions) {
    const ratingCounts = {};
    submissions.forEach(sub => {
        const bracket = Math.floor(sub.rating / 100) * 100;
        ratingCounts[bracket] = (ratingCounts[bracket] || 0) + 1;
    });
    const sortedBrackets = Object.keys(ratingCounts).sort((a, b) => a - b);
    return {
        labels: sortedBrackets.map(bracket => `${bracket}`),
        data: sortedBrackets.map(bracket => ratingCounts[bracket])
    };
}

function processTagData(submissions) {
    const tagCounts = {};
    submissions.forEach(sub => sub.tags.forEach(tag => tagCounts[tag] = (tagCounts[tag] || 0) + 1));
    const sortedTags = Object.entries(tagCounts).sort(([, a], [, b]) => b - a).slice(0, 15);
    return {
        labels: sortedTags.map(entry => entry[0]),
        data: sortedTags.map(entry => entry[1]),
        backgroundColors: sortedTags.map((_, i) => `hsl(${(i * 40) % 360}, 65%, 55%)`)
    };
}

function updateRatingDistributionChart({ labels, data }) {
    const ctx = document.getElementById('ratingDistributionChart').getContext('2d');
    if (ratingDistributionChart) ratingDistributionChart.destroy();
    ratingDistributionChart = new Chart(ctx, { 
        type: 'bar',
        data: { labels, datasets: [{ label: 'Problems Solved', data, backgroundColor: 'rgba(245, 166, 35, 0.7)', borderColor: 'rgba(245, 166, 35, 1)', borderWidth: 1 }] },
        options: {
            scales: { y: { beginAtZero: true, ticks: { color: '#aaa' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } }, x: { ticks: { color: '#aaa' }, grid: { display: false } } },
            plugins: { legend: { display: false } }
        }
    });
}

function updateTagsChart({ labels, data, backgroundColors }) {
    const ctx = document.getElementById('tagsChart').getContext('2d');
    if (tagsChart) tagsChart.destroy();
    tagsChart = new Chart(ctx, { 
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: backgroundColors, hoverOffset: 4, borderColor: '#262626' }] },
        options: {
            responsive: true,
            plugins: { legend: { position: 'right', labels: { color: '#ddd', boxWidth: 12, padding: 10, font: { size: 11 } } } }
        }
    });
}

// --- UI Helper Functions ---

function setLoadingState(isLoading, message = '') {
    const statusEl = document.getElementById('lc-analytics-status');
    if (!statusEl) return;
    if (isLoading) {
        statusEl.innerHTML = `<div class="lc-loader"></div><p style="margin-top: 8px;">${message}</p>`;
    } else {
        statusEl.innerHTML = `<p>${message}</p>`;
    }
}

function updateSummaryStats(ratedCount, unratedCount) {
    const summaryEl = document.getElementById('lc-analytics-summary');
    if(summaryEl) summaryEl.innerHTML = `<p>Showing analytics for <strong>${ratedCount}</strong> rated problems. <strong>${unratedCount}</strong> solved problems were not rated.</p>`;
}

function loadScript(url) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Script load error for ${url}`));
        document.head.appendChild(script);
    });
}


// --- Entry Point ---

// Use a MutationObserver to wait for the page to load the profile content
const observer = new MutationObserver(async (mutations, obs) => {
    const username = getUsernameFromURL();
    // We look for a more specific element that indicates the profile page is loaded
    const profileLoadedElement = document.querySelector('.flex.items-start.text-label-1');

    if (username && profileLoadedElement && !document.getElementById('lc-analytics-container')) {
        console.log(`LeetCode profile for "${username}" detected. Initializing analytics.`);
        obs.disconnect(); // Stop observing once we've found our target
        
        const container = injectAnalyticsContainer();
        if (container) {
            const ready = await initializeRatingData();
            if (ready) {
                handleFetch(username);
            }
        }
    }
});

// Start observing the body for changes
observer.observe(document.body, {
    childList: true,
    subtree: true
});