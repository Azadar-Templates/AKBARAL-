import type { MetadataRoute } from 'next';

/** Allow public content to be indexed; keep the API out of search engines. */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.AKBARAL_SITE_URL ?? 'https://akbaral.duckdns.org';
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
