# LeetCode Rating Analytics

A browser extension that provides a rating-based statistical breakdown of your solved LeetCode problems, similar to CF Analytics for Codeforces.

## Features

-   📊 **Problem Rating Distribution:** A bar chart showing the count of solved problems in different rating brackets.
-   🍩 **Tags Solved Distribution:** A donut chart showing the breakdown of solved problems by topic/tag.
-   📈 **Community-Sourced Ratings:** Uses the community-maintained `zerotrac/leetcode_problem_rating` dataset for objective problem ratings.
-    smartly Handles unrated problems by excluding them from the charts and showing a separate count.

## How to Install (for testing)

Since this is not on the Chrome Web Store, you need to "sideload" it locally.

1.  **Download:** Download the `leetcode-analytics` folder containing all the files (`manifest.json`, `popup.html`, etc.).
2.  **Open Chrome/Edge Extensions:** Go to `chrome://extensions` or `edge://extensions` in your browser.
3.  **Enable Developer Mode:** In the top-right corner, turn on the "Developer mode" toggle.
4.  **Load Unpacked:** Click the "Load unpacked" button that appears.
5.  **Select Folder:** In the file dialog, select the entire `leetcode-analytics` folder.

The extension icon should now appear in your browser's toolbar!

## How to Use

1.  Click the extension icon in your toolbar.
2.  Enter your LeetCode username in the input field.
3.  Click the "Fetch" button.
4.  View your analytics!

## Next Steps

-   Implement the real LeetCode GraphQL API call to fetch a user's actual submission history, replacing the current mock data function.