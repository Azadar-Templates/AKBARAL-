/**
 * Dynamic, honest ads.txt (launch readiness / AdSense).
 *
 * Serves the real Google AdSense authorization line ONLY when a genuine
 * publisher id (AKBARAL_ADSENSE_CLIENT, e.g. ca-pub-1234567890123456) is
 * configured. Without a publisher id this route answers 404 — a placeholder
 * ads.txt with a fake id would be worse than none.
 */
export function GET(): Response {
  const client = (process.env.AKBARAL_ADSENSE_CLIENT ?? '').trim();
  if (!client) {
    return new Response('ads.txt is not configured for this deployment.\n', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  const publisherId = client.replace(/^ca-pub-/, 'pub-');
  const body = `google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
