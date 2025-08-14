chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_LEETCODE_COOKIES") {
        Promise.all([
            new Promise(resolve => {
                chrome.cookies.get({ url: "https://leetcode.com", name: "LEETCODE_SESSION" }, cookie => resolve(cookie?.value || null));
            }),
            new Promise(resolve => {
                chrome.cookies.get({ url: "https://leetcode.com", name: "csrftoken" }, cookie => resolve(cookie?.value || null));
            })
        ]).then(([session, csrf]) => {
            sendResponse({ session, csrf });
        });
        return true;
    }
});
