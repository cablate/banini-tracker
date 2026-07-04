export interface FetchPostsOptions {
  target: string;
  token: string;
  maxPosts?: number;
  since?: string;
  until?: string;
}

export interface SourceAdapter<TPost> {
  type: string;
  fetchPosts(opts: FetchPostsOptions): Promise<TPost[]>;
}
