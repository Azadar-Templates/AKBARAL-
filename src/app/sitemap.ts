import type { MetadataRoute } from 'next';

/**
 * Public sitemap. Lists the public marketing/documentation routes that
 * exist — the app itself is a single-page experience behind `/`.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.AKBARAL_SITE_URL ?? 'https://akbaral.duckdns.org';
  const routes = ['/', '/features', '/pricing', '/security', '/about', '/privacy', '/terms'];
  const now = new Date();
  return routes.map((route) => ({
    url: `${base}${route}`,
    lastModified: now,
    changeFrequency: route === '/' ? 'weekly' : 'monthly',
    priority: route === '/' ? 1 : 0.7,
  }));
}
