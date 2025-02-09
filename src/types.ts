// bot_twitter
export interface InsertNewPostDetails {
  id?: number;
  post_id: number;
  post_content: string;
  post_pinned: number;
  handle: string;
  retweet: number;
  retweet_handle: string;
  crypto_related: number;
  created: number;
  posted_in_discord: number;
}
