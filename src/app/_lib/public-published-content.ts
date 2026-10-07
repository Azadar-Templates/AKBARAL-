import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type PublishedBlogPost = { slug: string; title: string; date: string | null; excerpt: string | null };

function contentDirectories() {
  return [path.join(process.cwd(), 'content', 'blog'), path.join(process.cwd(), 'src', 'content', 'blog')];
}

function frontMatter(source: string, key: string) {
  const match = source.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'mi'));
  return match?.[1]?.trim() || null;
}

/** Only files that are actually checked into an approved blog directory are public posts. */
export function readPublishedBlogPosts(): PublishedBlogPost[] {
  const directory = contentDirectories().find((candidate) => existsSync(candidate));
  if (!directory) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(md|mdx|json)$/i.test(entry.name))
    .map((entry) => {
      const file = path.join(directory, entry.name);
      const source = readFileSync(file, 'utf8');
      if (/^draft:\s*true\s*$/im.test(source)) return null;
      const slug = entry.name.replace(/\.(md|mdx|json)$/i, '');
      return {
        slug,
        title: frontMatter(source, 'title') ?? slug.replace(/[-_]+/g, ' '),
        date: frontMatter(source, 'date'),
        excerpt: frontMatter(source, 'excerpt') ?? frontMatter(source, 'description'),
      };
    })
    .filter((post): post is PublishedBlogPost => Boolean(post));
}

/** No public team directory is published unless owner-verified records are added here. */
export function readVerifiedTeamMembers(): [] {
  return [];
}
