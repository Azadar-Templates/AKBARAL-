import { PublicFrame } from '../public-info';
import { readPublishedBlogPosts } from '../../_lib/public-published-content';
import styles from '../public-info.module.css';

export default function BlogPage() {
  const posts = readPublishedBlogPosts();
  return <PublicFrame kind="blog"><section className={styles.directoryState} aria-label="Blog posts">
    {posts.length ? <div className={styles.postGrid}>{posts.map((post) => <article className={styles.postCard} key={post.slug}><span className={styles.emptyLabel}>{post.date ?? 'PUBLISHED POST'}</span><h2>{post.title}</h2>{post.excerpt ? <p>{post.excerpt}</p> : null}</article>)}</div> : <div className={styles.emptyState}>
      <span className={styles.emptyLabel}>REPOSITORY CHECK</span>
      <h2>No published posts yet.</h2>
      <p>There are no posts in the repository blog directories. The subscribe placeholder is intentionally inactive until a real subscription route exists.</p>
      <div className={styles.subscribePlaceholder} aria-label="Blog subscription placeholder"><span>Subscribe</span><input disabled placeholder="Not configured yet" aria-label="Subscription not configured" /></div>
    </div>}
  </section></PublicFrame>;
}
