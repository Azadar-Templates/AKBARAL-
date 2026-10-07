'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PublicPricingTable } from './public-pricing';
import { PublicSiteFooter, PublicSiteHeader } from './public-site-chrome';
import styles from './landing-reset.module.css';

function useSignedInHint() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    try { setSignedIn(Boolean(window.localStorage.getItem('ak_access'))); } catch { setSignedIn(false); }
  }, []);
  return signedIn;
}

const pipeline = [
  ['01', 'Understand', 'Goal understanding'],
  ['02', 'Plan', 'Planner and task lifecycle'],
  ['03', 'Route', 'MASTER and specialist agents'],
  ['04', 'Verify', 'Tools, fallback, and review'],
];

export function LandingReset() {
  const signedIn = useSignedInHint();
  const primaryHref = signedIn ? '/chat' : '/signup';
  const primaryLabel = signedIn ? 'Go to your workspace' : 'Start free';

  return (
    <main className={styles.page}>
      <PublicSiteHeader />

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <span className={styles.kicker}>A calmer way to get real work done</span>
          <h1 id="hero-title">One intelligence for the whole job.</h1>
          <p>AKBARAL! understands the goal, plans the work, routes it through the right capabilities, and returns a result you can review.</p>
          <div className={styles.heroCtas}>
            <Link className={styles.primary} href={primaryHref}>{primaryLabel}<span aria-hidden="true">↗</span></Link>
            <Link className={styles.secondary} href="/work">See Work in action</Link>
          </div>
          <p className={styles.heroNote}><span className={styles.liveDot} /> Real Chat and Work flows. Configured providers only.</p>
        </div>

        <div className={styles.heroVisual} aria-label="Product interface overview: AKBARAL! orchestration">
          <div className={styles.visualGrid} aria-hidden="true" />
          <div className={styles.pipelineCard}>
            <div className={styles.visualHeader}><span>AKBARAL! core</span><span className={styles.status}>READY</span></div>
            <div className={styles.goalRow}><span className={styles.goalMark}>⌁</span><div><small>YOUR GOAL</small><b>Turn a complex brief into a useful result.</b></div></div>
            <div className={styles.pipelineList}>
              {pipeline.map(([number, title, detail], index) => <div className={styles.pipelineRow} key={number}><span className={styles.pipelineNumber}>{number}</span><span className={styles.pipelineLine} data-active={index === 1 ? 'true' : undefined} /><span><b>{title}</b><small>{detail}</small></span><span className={styles.pipelineState}>{index < 1 ? 'done' : index === 1 ? 'active' : 'next'}</span></div>)}
            </div>
          </div>
          <div className={styles.signalCard}><span className={styles.signalIcon}>✓</span><div><b>Verification stays visible</b><small>Outputs, activity, and limits remain part of the product surface.</small></div></div>
          <div className={styles.orb}><span>A!</span><small>ONE CORE</small></div>
        </div>
      </section>

      <section className={styles.proofBar} aria-label="Quick paths and product principles">
        <div><span className={styles.proofIcon}>↳</span><span><b>Goal → result</b><small>One continuous work surface</small></span></div>
        <div><span className={styles.proofIcon}>◌</span><span><b>Real capabilities</b><small>Catalog and provider truth</small></span></div>
        <div><span className={styles.proofIcon}>⌁</span><span><b>Reviewable work</b><small>Artifacts, stages, and activity</small></span></div>
      </section>

      <section className={styles.section} id="how-it-works" aria-labelledby="features-title">
        <div className={styles.sectionHead}><span className={styles.eyebrow}>From intent to outcome</span><h2 id="features-title">The handoff between thinking and doing, made clear.</h2><p>AKBARAL! is One simple product: it brings the orchestration layer into view without making you manage the machinery.</p></div>
        <div className={styles.storyGrid}>
          <article className={styles.storyLead}><span className={styles.storyNumber}>01</span><h3>Start with the goal, not a tool.</h3><p>Use Chat for an open-ended conversation or Work for a tracked task. The system begins with what you are trying to accomplish.</p><div className={styles.quote}><span>“</span><p>Describe the goal in your own words. The next step is planning, not menu hunting.</p></div></article>
          <div className={styles.storySteps}>{pipeline.map(([number, title, detail]) => <div className={styles.storyStep} key={number}><span>{number}</span><div><b>{title}</b><p>{detail}. AKBARAL! keeps the transition explicit and the state honest.</p></div></div>)}</div>
        </div>
      </section>

      <section className={styles.section} id="surfaces" aria-labelledby="integrations-title">
        <div className={styles.sectionHead}><span className={styles.eyebrow}>One product, four surfaces</span><h2 id="integrations-title">Everything you need stays close to the work.</h2></div>
        <div className={styles.surfaceGrid}>
          <Link className={`${styles.surfaceCard} ${styles.surfacePrimary}`} href="/chat"><span className={styles.surfaceTag}>PRIMARY MODE</span><h3 id="thread-title">Chat</h3><p>Think out loud with one intelligence. Conversations, attachments, model truth, and tool activity stay together.</p><span className={styles.surfaceArrow}>Open Chat ↗</span></Link>
          <Link className={styles.surfaceCard} href="/work"><span className={styles.surfaceTag}>PRIMARY MODE</span><h3>Work</h3><p>Turn a goal into a tracked run with visible stages, a sandboxed preview, and authenticated export.</p><span className={styles.surfaceArrow}>Open Work ↗</span></Link>
          <Link className={styles.surfaceCard} href="/agents"><span className={styles.surfaceTag}>CAPABILITY REGISTRY</span><h3 id="agents-title">Agents</h3><p>Search the 4,001 registered agent contracts by capability and category. The registry describes configuration, not availability or revenue.</p><span className={styles.surfaceArrow}>Explore Agents ↗</span></Link>
          <Link className={styles.surfaceCard} href="/dashboard"><span className={styles.surfaceTag}>ACCOUNT VIEW</span><h3>Dashboard</h3><p>Current work, credits, activity, plan, and sessions in a compact view that helps you decide what is next.</p><span className={styles.surfaceArrow}>Open Dashboard ↗</span></Link>
        </div>
      </section>

      <section className={`${styles.section} ${styles.safetySection}`} id="safety" aria-labelledby="security-title">
        <div className={styles.safetyPanel}><div><span className={styles.eyebrow}>Built for trust</span><h2 id="security-title">Power is useful when the boundaries are visible.</h2><p>AKBARAL! reports configured providers, available agents, task state, credits, and artifacts as they are. It does not turn an empty state into a promise.</p></div><div className={styles.safetyList}><span><i>01</i>Scoped account records</span><span><i>02</i>Sandboxed previews</span><span><i>03</i>Server-enforced permissions</span><span><i>04</i>Successful Work only consumes credits</span></div></div>
      </section>

      <section className={`${styles.section} ${styles.factorySection}`} aria-labelledby="steps-title">
        <div className={styles.factoryVisual} aria-hidden="true"><div className={styles.factoryCore}>A!</div><span className={styles.factoryNode} data-node="one">Purpose</span><span className={styles.factoryNode} data-node="two">Tools</span><span className={styles.factoryNode} data-node="three">Verify</span></div>
        <div className={styles.factoryCopy}><span className={styles.eyebrow}>Agent Factory</span><h2 id="steps-title">Shape the specialist you actually need.</h2><p>Describe a purpose, choose capabilities and permissions, create it through the existing factory, then review its security and benchmark state before it becomes part of your workspace.</p><Link className={styles.secondary} href="/agent-factory">Open Agent Factory ↗</Link></div>
      </section>

      <section className={`${styles.section} ${styles.pricingSection}`} id="pricing" aria-labelledby="pricing-title">
        <div className={styles.pricingIntro}><span className={styles.eyebrow}>Simple capacity</span><h2 id="pricing-title">Start small. Scale when the work does.</h2><p>USD plans built around successful Work tasks. No invented usage, no mystery tiers.</p><Link className={styles.textLink} href="/pricing">See plans and pricing ↗</Link></div>
        <PublicPricingTable />
      </section>

      <section className={`${styles.section} ${styles.faqSection}`} aria-labelledby="faq-title"><div className={styles.sectionHead}><span className={styles.eyebrow}>A few clear answers</span><h2 id="faq-title">Less ceremony. More useful work.</h2></div><div className={styles.faqGrid}><details className={styles.faqItem}><summary>Does Chat use Work task credits?</summary><p>No. Chat is a conversation surface. Work task credits are consumed only when a successful Work task is recorded.</p></details><details className={styles.faqItem}><summary>Can I see what happened during a Work run?</summary><p>Yes, where the configured flow supports it: task state, tool activity, verification, output, and history remain in the Work surface.</p></details><details className={styles.faqItem}><summary>Can I create a specialist agent?</summary><p>Yes. Agent Factory uses the authenticated factory contracts for templates, creation, security review, benchmarks, versions, and lifecycle status.</p></details><details className={styles.faqItem}><summary>Are plans priced in USD?</summary><p>Yes. AKBARAL! pricing is USD-only, with six published plans and no hidden regional currency switch.</p></details></div></section>

      <section className={styles.final} aria-labelledby="final-title"><span className={styles.eyebrow}>Ready when you are</span><h2 id="final-title">Give the goal one place to go.</h2><p>Open the workspace and let AKBARAL! carry the work from first sentence to verified result.</p><div className={styles.heroCtas}><Link className={styles.primary} href={primaryHref}>{primaryLabel}<span aria-hidden="true">↗</span></Link><Link className={styles.secondary} href="/help">Read the product guide</Link></div></section>

      <PublicSiteFooter />
    </main>
  );
}
