import dotenv from "dotenv"; // zero-dependency module that loads environment variables from a .env

// Load environment variables from the .env file
dotenv.config();

// Start requesting data
export async function sendMessageOnDiscord(botChannel: any, messages: string[]): Promise<boolean> {
  // Send each message to the bot channel
  messages.forEach((message) => {
    botChannel
      .send(message)
      .then(() => {
        console.log(`✅ Successfully sent: "${message}"`);
      })
      .catch((error: Error) => {
        console.error(`🚫 Failed to send: "${message}". Error:`, error);
      });
  });
  return true;
}
