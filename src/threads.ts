export interface ThreadsPost {
  id: string;
  source: 'threads';
  text: string;
  timestamp: string;
  likeCount: number;
  replyCount: number;
  url: string;
  mediaType: string;
  mediaUrl: string;
  ocrText: string;
}

export async function fetchThreadsPosts(
  username: string,
  token: string,
  maxPosts = 3,
): Promise<ThreadsPost[]> {
  const actorId = 'futurizerush~meta-threads-scraper';
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      mode: 'user',
      usernames: [username],
      max_posts: maxPosts,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Apify Threads 請求失敗: ${res.status} ${body.slice(0, 200)}`);
  }

  const raw = (await res.json()) as any[];

  return raw.map((item) => ({
    id: item.post_code ?? item.id ?? item.code ?? String(item.pk),
    source: 'threads' as const,
    text: item.text_content ?? item.text ?? item.caption ?? '',
    timestamp: item.created_at ?? item.timestamp ?? new Date().toISOString(),
    likeCount: item.like_count ?? item.likeCount ?? 0,
    replyCount: item.reply_count ?? item.replyCount ?? 0,
    url: item.post_url ?? item.url ?? `https://www.threads.net/@${username}/post/${item.post_code ?? item.id}`,
    mediaType: item.media_type ?? 'text',
    mediaUrl: item.media_url ?? '',
    ocrText: '',
  }));
}
