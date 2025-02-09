import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { config } from "./../config";
import { InsertNewPostDetails } from "../types";

// Posts
export async function createPostsTable(database: any): Promise<boolean> {
  try {
    await database.exec(`
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL UNIQUE,
            post_content STRING,
            post_pinned INTEGER DEFAULT 0,
            handle STRING NOT NULL,
            retweet INTEGER DEFAULT 0,
            retweet_handle STRING,
            crypto_related INTEGER DEFAULT 0,
            created INTEGER NOT NULL,
            posted_in_discord INTEGER DEFAULT 0
        );
      `);
    return true;
  } catch (error: any) {
    console.error("Error creating TokenData table:", error);
    return false;
  }
}
export async function selectPostExistsByPostId(postId: number): Promise<any[]> {
  try {
    const db = await open({
      filename: config.db.db_name_tracker_tweets,
      driver: sqlite3.Database,
    });

    // Create Table if not exists
    const postsTableExists = await createPostsTable(db);
    if (!postsTableExists) {
      await db.close();
      throw new Error("Could not create posts table.");
    }

    // Query the database for matching tokens
    const transfer = await db.all(
      `
      SELECT * 
      FROM posts
      WHERE post_id=?;
    `,
      [postId]
    );

    // Close the database
    await db.close();

    // Return the results
    return transfer;
  } catch (error: any) {
    console.error("Error while checking post:", error);
    return [];
  }
}
export async function insertNewPost(newPost: InsertNewPostDetails): Promise<boolean> {
  try {
    const db = await open({
      filename: config.db.db_name_tracker_tweets,
      driver: sqlite3.Database,
    });

    // Create Table if not exists
    const postsTableExists = await createPostsTable(db);
    if (!postsTableExists) {
      await db.close();
      throw new Error("Could not create posts table.");
    }

    // Proceed with adding holding
    if (postsTableExists) {
      const { post_id, post_content, post_pinned, handle, retweet, retweet_handle, crypto_related, created, posted_in_discord } = newPost;

      await db.run(
        `
      INSERT INTO posts (post_id, post_content, post_pinned, handle, retweet, retweet_handle, crypto_related, created, posted_in_discord)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `,
        [post_id, post_content, post_pinned, handle, retweet, retweet_handle, crypto_related, created, posted_in_discord]
      );

      await db.close();
    }
    return true;
  } catch (error: any) {
    console.error("Error storing post:", error);
    return false;
  }
}
