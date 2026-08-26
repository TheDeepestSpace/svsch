// Shared PR review-comment upsert used by CI stats-reporting jobs (see
// upsert-pr-stats-comment.mjs) — finds an existing review whose body starts
// with `startTag` and replaces it, or posts a new one.

// GitHub occasionally hasn't finished replicating a just-created/updated PR
// to the graph backing these REST endpoints yet, which surfaces as a 404
// complaining it "Could not resolve to a node with the global id" of the PR
// — purely a replication-lag blip, not a real 404. Retry that (and plain
// 5xx flakiness) a few times with backoff before giving up.
const isTransient = (status, text) =>
  status >= 500 ||
  (status === 404 && text.includes('Could not resolve to a node with the global id'));

export async function upsertReviewComment({
  apiUrl = 'https://api.github.com',
  owner,
  repo,
  prNumber,
  token,
  startTag,
  body,
  networkTimeoutMs = 60_000,
}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const request = async (method, apiPath, requestBody) => {
    const maxAttempts = 4;
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(`${apiUrl}${apiPath}`, {
        method,
        headers,
        body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
        signal: AbortSignal.timeout(networkTimeoutMs),
      });
      if (response.ok) return response.json();
      const text = await response.text();
      if (attempt >= maxAttempts || !isTransient(response.status, text)) {
        throw new Error(`${method} ${apiPath} failed (${response.status}): ${text}`);
      }
      console.warn(
        `${method} ${apiPath} failed (${response.status}), retrying (${attempt}/${maxAttempts})...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    }
  };

  const reviews = [];
  for (let page = 1; ; page++) {
    const batch = await request(
      'GET',
      `/repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100&page=${page}`,
    );
    reviews.push(...batch);
    if (batch.length < 100) break;
  }

  const existing = reviews.find((review) => review.body?.startsWith(startTag));
  if (existing) {
    await request('PUT', `/repos/${owner}/${repo}/pulls/${prNumber}/reviews/${existing.id}`, {
      body,
    });
    return 'updated';
  }
  await request('POST', `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
    event: 'COMMENT',
    body,
  });
  return 'created';
}
