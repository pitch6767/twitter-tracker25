export const config = {
  db: {
    db_name_tracker_tweets: "src/db/tweets.db", // Sqlite Database location
  },
  bot_twitter: {
    tracker_timeout: 300000, // 5 min
    run_headless: true,
    default_browser: "C:/Program Files/Google/Chrome/Application/chrome.exe", // Replace with the path to your browser
    default_browser_data: "C:/Users/bevan/AppData/Local/Google/Chrome/User Data", // Replace with the path to your browser's user data directory
    accounts: [
      {
        name: "Donald J. Trump",
        handle: "realDonaldTrump",
      },
      {
        name: "DigitalBenjamins",
        handle: "digbenjamins",
      },
    ],
  },
};
