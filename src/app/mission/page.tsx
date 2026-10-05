'use client';

import { AppShell, shellStyles as s } from '../_components/app-shell';

export default function MissionPage() {
  return <AppShell title="Mission"><div className={s.pageHead}><div><span className={s.eyebrow}>Mission</span><h2>Mission context stays explicit.</h2><p>This customer workspace does not connect to the separate owner mission service. No fleet, revenue, user, or execution figures are shown here.</p></div></div><section className={s.panel}><div className={s.empty}><h3>Mission data is not available in this account surface.</h3><p>Use Chat and Work for customer tasks. Owner-only operational controls remain behind their dedicated server authorization and are not represented as a public dashboard.</p></div></section></AppShell>;
}
