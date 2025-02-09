import * as dotenv from "dotenv";
import puppeteer from "puppeteer"; // Puppeteer is a JavaScript library which provides a high-level API to control Chrome or Firefox
import { config } from "./config"; // Configuration parameters for our bot
import { insertNewPost, selectPostExistsByPostId } from "./db/db";
import { sendMessageOnDiscord } from "./discord/discordSend";
import { Client, Events, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { InsertNewPostDetails } from "./types";

// Load environment variables from the .env file
dotenv.config();

// Create a new browser
let browser: any;
async function initBrowser() {
  browser = await puppeteer.launch({
    headless: config.bot_twitter.run_headless || false,
    executablePath: config.bot_twitter.default_browser,
    userDataDir: config.bot_twitter.default_browser_data,
    args: ["--start-maximized"], // Launch maximized Window
    defaultViewport: null, // Disable default viewport settings
  });
}

// Function to get the posts
async function getXAccountLatestPosts(name: string, handle: string): Promise<string[]> {
  if (!name || !handle) return [];

  // Create new browser if not available
  if (!browser) await initBrowser();

  // Open a new page in the browser
  const page = await browser.newPage();
  await page.goto("https://x.com/" + handle, { waitUntil: "load" });

  // Wait for 1 more second to be sure we can copy the link
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Extract links with "/handle/status/{id}"
  const filteredLinks = await page.evaluate(
    (name: string, handle: string) => {
      // Find the parent div with the specific aria-label
      const parentDiv = document.querySelector(`div[aria-label="Timeline: ${name}’s posts"]`);
      if (!parentDiv) return [];

      // Find all <a> tags within the nested divs
      const anchorTags = Array.from(parentDiv.querySelectorAll("a"));

      // Filter links containing "/handle/status/" but not "/analytics"
      const links = anchorTags
        .map((anchor) => anchor.href)
        .filter((href) => href.includes(`/status/`) && !href.includes("/analytics") && !href.includes("/photo"));

      return links; // Return the filtered links
    },
    name,
    handle // Pass the parameters to the browser context
  );

  await browser.close();
  browser = null;

  return filteredLinks;
}

// Discord
let discordClient: any = null;
let botChannel: any = null;
async function initializeDiscord(channel: string, botToken: string): Promise<boolean> {
  const discordBotToken = botToken || "";
  const botChannelId = channel || "";

  if (!discordBotToken || !botChannelId) {
    console.log("🚫 Discord Bot not started. Missing Discord bot token or channel ID.");
    return false;
  }

  try {
    // Initialize and log in the Discord client
    discordClient = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    });
    await discordClient.login(discordBotToken);

    // Make sure bot is ready
    await discordClient.on(Events.ClientReady, () => {
      // Fetch the bot channel
      botChannel = discordClient.channels.cache.get(botChannelId);

      if (botChannel) {
        console.log("✅ Discord bot connected.");
      } else {
        console.log("🚫 Bot channel not found or is not a TextChannel.");
        return false;
      }
    });

    return true;
  } catch (error) {
    console.error("🚫 Error initializing Discord bot:", error);
    return false;
  }
}

// Main to fetch tweets
async function main(): Promise<void> {
  if (!discordClient && !botChannel) {
    // Discord Parameters
    const discordChannel = process.env.DISCORD_CT_TRACKER_CHANNEL || "";
    const discordBot = process.env.DISCORD_BOT_TOKEN || "";
    const init = await initializeDiscord(discordChannel, discordBot);
    if (init) console.log("✅ Discord bot ready for use.");
  }

  try {
    // Accounts
    const xAccounts = config.bot_twitter.accounts;
    const discordMessages: string[] = [];

    // Get all the accounts
    for (const xAccount of xAccounts) {
      // Get account details
      const xName = xAccount.name;
      const xhandle = xAccount.handle;
      if (!xName || !xhandle) continue;

      //Output Logs
      console.log("🔍 Checking posts for " + xName);

      const latestPosts = await getXAccountLatestPosts(xName, xhandle);
      if (!latestPosts) continue;

      for (const post of latestPosts) {
        const match = post.match(/^https:\/\/x\.com\/([\w_]+)\/status\/(\d+)$/);
        if (match) {
          const urlHandle = match[1];
          const id = match[2];
          const retweet = urlHandle !== xhandle ? 1 : 0;
          let newPost: InsertNewPostDetails;

          // Check if proper formats
          if (typeof urlHandle === "string" && !isNaN(Number(id))) {
            // Check if exists in db already
            const exists = await selectPostExistsByPostId(Number(id));
            if (exists.length !== 0) continue;

            if (retweet === 1) {
              discordMessages.push(`📢 ${xName} retweeted ${urlHandle}: https://x.com/${urlHandle}/status/${id}`);
            } else {
              discordMessages.push(`📢 ${xName} tweeted: https://x.com/${xhandle}/status/${id}`);
            }

            // Add to db
            const unixTimestampMs = Date.now();
            newPost = {
              post_id: Number(id),
              post_content: "",
              post_pinned: 0,
              handle: xhandle,
              retweet: retweet,
              retweet_handle: urlHandle,
              crypto_related: 1,
              created: unixTimestampMs,
              posted_in_discord: 1,
            };
            const added = await insertNewPost(newPost);
            if (added) console.log("✅ Twitter post stored in database");
          }
        }
      }

      // Wait for 3 more second before moving to the other account
      const randomWaitTime = Math.floor(Math.random() * (10000 - 3000 + 1)) + 3000;
      await new Promise((resolve) => setTimeout(resolve, randomWaitTime));
    }

    // Send to Discord
    if (botChannel && discordMessages.length !== 0) {
      // Output amount of posts
      console.log("✅ Collected " + discordMessages.length + " tweets.");

      const sentConfirmation = await sendMessageOnDiscord(botChannel, discordMessages);
      if (sentConfirmation) console.log("✅ Discord Messages Sent!");
    }

    setTimeout(main, config.bot_twitter.tracker_timeout);
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch((err) => {
  console.error("Initialization error:", err.message);
  process.exit(1); // Exit if initialization fails
});
