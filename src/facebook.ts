export interface FacebookPost {
  id: string;
  source: 'facebook';
  text: string;
  ocrText: string;
  captionText: string;
  timestamp: string;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  url: string;
  mediaType: string;
  mediaUrl: string;
}

export async function fetchFacebookPosts(
  pageUrl: string,
  token: string,
  maxPosts = 3,
): Promise<FacebookPost[]> {
  const actorId = 'apify~facebook-posts-scraper';
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      startUrls: [{ url: pageUrl }],
      resultsLimit: maxPosts,
      captionText: true,
    }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Apify FB 請求失敗: ${res.status} ${body.slice(0, 200)}`);
  }

  const raw = (await res.json()) as any[];

  return raw.map((item) => {
    const media = item.media?.[0];
    const ocrTexts = (item.media ?? [])
      .map((m: any) => m.ocrText ?? '')
      .filter((t: string) => t.length > 0);

    // captionText 可能在 media item 或頂層
    const captionTexts = (item.media ?? [])
      .map((m: any) => m.captionText ?? '')
      .filter((t: string) => t.length > 0);
    const captionText = captionTexts.join('\n') || item.captionText || '';

    return {
      id: `fb_${item.postId ?? item.id ?? ''}`,
      source: 'facebook' as const,
      text: item.text ?? item.message ?? '',
      ocrText: ocrTexts.join('\n'),
      captionText,
      timestamp: item.time ?? new Date().toISOString(),
      likeCount: item.likes ?? 0,
      commentCount: item.comments ?? 0,
      shareCount: item.shares ?? 0,
      url: item.url ?? '',
      mediaType: media?.__typename?.toLowerCase() ?? 'text',
      mediaUrl: media?.video_url ?? media?.playable_url
        ?? (media?.__typename?.toLowerCase() === 'video' ? media?.url : null)
        ?? media?.thumbnail ?? media?.photo_image?.uri ?? '',
    };
  });
}
