import { PublicFrame } from '../public-info';
import { readVerifiedTeamMembers } from '../../_lib/public-published-content';
import styles from '../public-info.module.css';

export default function TeamPage() {
  const members = readVerifiedTeamMembers();
  return <PublicFrame kind="team"><section className={styles.directoryState} aria-label="Team directory">
    {members.length ? members.map((member) => <article key={member}>{member}</article>) : <div className={styles.emptyState}>
      <span className={styles.emptyLabel}>VERIFIED DIRECTORY</span>
      <h2>Team information coming soon.</h2>
      <p>No owner-verified public contributor records are published in this repository yet. We will not invent people, photos, bios, or titles to fill the space.</p>
    </div>}
  </section></PublicFrame>;
}
