'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './landing-reset.module.css';

function useSignedInHint() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    try { setSignedIn(Boolean(window.localStorage.getItem('ak_access'))); } catch { setSignedIn(false); }
  }, []);
  return signedIn;
}

export function LandingReset() {
  const signedIn = useSignedInHint();
  const primaryHref = signedIn ? '/chat' : '/signup';
  const primaryLabel = signedIn ? 'Go to your workspace' : 'Start free';

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <Link className={styles.brand} href="/" aria-label="AKBARAL! home"><span className={styles.mark}>A!</span> AKBARAL!</Link>
          <nav className={styles.nav} aria-label="Landing sections">
            <a href="#features">Features</a>
            <a href="#agents">Agents</a>
            <a href="#security">Security</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className={styles.actions}>
            <Link className={styles.ghost} href="/signin">Sign in</Link>
            <Link className={styles.primary} href={primaryHref}>{primaryLabel}</Link>
          </div>
        </div>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <span className={styles.kicker}>One simple product</span>
        <h1 id="hero-title">One Intelligence. Every Solution.</h1>
        <p>AKBARAL! gives you a single place to chat, run Work tasks, manage files, review credits, and keep projects organized without switching products.</p>
        <div className={styles.heroCtas}>
          <Link className={styles.primary} href={primaryHref}>{primaryLabel}</Link>
          <Link className={styles.secondary} href="/pricing">See plans and pricing</Link>
        </div>
        <div className={styles.mock} aria-label="Product interface overview">
          <div className={styles.mockTop}><span>AKBARAL! workspace</span><span className={styles.dots} aria-hidden="true"><span /><span /><span /></span></div>
          <div className={styles.mockBody}>
            <div className={styles.mockMain}>
              <div className={styles.mockEmpty}><b>Ready for your first request</b><span>Real chats and Work results appear after sign-in.</span></div>
              <div className={styles.composer}>
                <div className={styles.composerBox}>Large goal composer</div>
                <div className={styles.composerFoot}><span>Enter sends · Shift+Enter adds a line</span><span>Gemini family when configured</span></div>
              </div>
            </div>
            <aside className={styles.mockRail} aria-label="Workspace inventory">
              <div className={styles.railCard}><b>Files</b><p>Your uploaded documents and images stay account-scoped.</p></div>
              <div className={styles.railCard}><b>Projects</b><p>Group task context, artifacts, and knowledge by workspace.</p></div>
              <div className={styles.railCard}><b>Credits</b><p>Work credits are charged only on successful completion.</p></div>
            </aside>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-label="Quick paths">
        <div className={styles.chips}>
          {['New chat', 'Files & documents', 'Images', 'Projects', 'Agents', 'Billing & credits'].map((chip) => <span className={styles.chip} key={chip}>{chip}</span>)}
        </div>
      </section>

      <section className={styles.section} id="features" aria-labelledby="features-title">
        <div className={styles.sectionHead}>
          <h2 id="features-title">Focused on the work surface you actually use.</h2>
          <p>One dark interface, large inputs, honest empty states, and no route that swaps you into a different design.</p>
        </div>
        <div className={styles.grid3}>
          <article className={styles.card}><span className={styles.icon}>1</span><h3>Ask naturally</h3><p>Use the large chat composer for planning, writing, analysis, and follow-up conversation.</p></article>
          <article className={styles.card}><span className={styles.icon}>2</span><h3>Run a task</h3><p>Work mode shows the goal, stages, preview rail, image upload, and authenticated export.</p></article>
          <article className={styles.card}><span className={styles.icon}>3</span><h3>Keep context</h3><p>Files, images, projects, billing, settings, and help live in one consistent workspace chrome.</p></article>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="integrations-title">
        <div className={styles.note}>
          <div><h2 id="integrations-title">Integrations are reported honestly.</h2><p>The app reads configured model availability from the existing model catalog, uploads through project file endpoints, and exports Work results through authenticated ZIP downloads.</p></div>
          <div className={styles.noteList}><span>Configured models only</span><span>Project files</span><span>Authenticated exports</span></div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="thread-title">
        <div className={styles.sectionHead}>
          <h2 id="thread-title">Chat stays clear.</h2>
          <p>The thread area starts empty, then fills with your real messages and AKBARAL! responses after sign-in.</p>
        </div>
        <div className={styles.thread} aria-label="Chat thread layout demonstration">
          <div className={`${styles.bubble} ${styles.bubbleUser}`}><b>You</b><p>Your actual prompt appears here.</p></div>
          <div className={styles.bubble}><b>AKBARAL!</b><p>The response area streams real output from the configured model route. Chat never deducts Work task credits.</p></div>
        </div>
      </section>

      <section className={styles.section} id="agents" aria-labelledby="agents-title">
        <div className={styles.note}>
          <div><h2 id="agents-title">4,001 registered agent contracts.</h2><p>The registry describes specialist contracts, capabilities, inputs, tool permissions, and verification rules. AKBARAL! never describes them as active or earning unless a real run proves it.</p></div>
          <Link className={styles.secondary} href="/agents">Open Agents</Link>
        </div>
      </section>

      <section className={styles.section} id="security" aria-labelledby="security-title">
        <div className={styles.note}>
          <div><h2 id="security-title">Security is built into the visible flow.</h2><p>Passwords use server-side hashing, refresh sessions are rotated, authenticated APIs scope records to the owner, and file previews stay sandboxed.</p></div>
          <div className={styles.noteList}><span>Scoped records</span><span>Rotated sessions</span><span>Sandboxed preview</span></div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="steps-title">
        <div className={styles.sectionHead}>
          <h2 id="steps-title">Three steps from blank page to result.</h2>
        </div>
        <div className={styles.steps}>
          <article className={styles.step}><span className={styles.stepNum}>01</span><h3>Sign in</h3><p>Use email and password, or a configured Google or GitHub provider.</p></article>
          <article className={styles.step}><span className={styles.stepNum}>02</span><h3>Describe the goal</h3><p>Choose Chat for conversation or Task for a tracked Work run.</p></article>
          <article className={styles.step}><span className={styles.stepNum}>03</span><h3>Review the result</h3><p>Check the stage trail, preview the artifact, and export only authenticated work.</p></article>
        </div>
      </section>

      <section className={styles.section} id="faq" aria-labelledby="faq-title">
        <div className={styles.sectionHead}><h2 id="faq-title">FAQ</h2></div>
        <div className={styles.faq}>
          <details className={styles.faqItem}><summary>Does the landing page redirect signed-in visitors?</summary><p>No. The landing page remains the landing page. Signed-in visitors use the workspace CTA to open Chat.</p></details>
          <details className={styles.faqItem}><summary>When are Work credits used?</summary><p>Credits are consumed only on success. Failed or cancelled Work is refunded automatically by the credit flow.</p></details>
          <details className={styles.faqItem}><summary>Which chat models are shown?</summary><p>The app lists only currently functional Gemini-family choices reported by the model catalog. It does not list unavailable providers.</p></details>
          <details className={styles.faqItem}><summary>Is there a light theme?</summary><p>The committed product theme is dark. Light appearance is marked coming soon until it is real.</p></details>
        </div>
      </section>

      <section className={styles.final} aria-labelledby="final-title">
        <h2 id="final-title">Open one workspace for every task.</h2>
        <p>Start free with 5 successful Work tasks during the 30-day trial, then choose a USD plan when you need more capacity.</p>
        <div className={styles.heroCtas}>
          <Link className={styles.primary} href={primaryHref}>{primaryLabel}</Link>
          <Link className={styles.secondary} href="/help">Read help</Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>© {new Date().getUTCFullYear()} AKBARAL!</span>
          <div className={styles.footerLinks}><Link href="/pricing">Pricing</Link><Link href="/help">Help</Link><Link href="/signin">Sign in</Link></div>
        </div>
      </footer>
    </main>
  );
}
