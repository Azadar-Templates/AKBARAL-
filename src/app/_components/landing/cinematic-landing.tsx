'use client';

import type { ReactNode } from 'react';
import { ArrowRight, CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react';
import styles from './cinematic-landing.module.css';

const PLANS = [
  ['Free', '$0', '5 tasks', '30-day trial'],
  ['Starter', '$10', '25 tasks', 'For focused work'],
  ['Pro', '$50', '100 tasks', 'For professionals'],
  ['Business', '$90', '250 tasks', 'For growing teams'],
  ['Scale', '$200', '750 tasks', 'For high-volume work'],
  ['Enterprise', '$400', '2,000 tasks', 'For organizations'],
] as const;

const FEATURES = [
  ['Orchestration', 'Turn a goal into a clear sequence, with the right specialist contract at each step.'],
  ['Verification', 'Keep success checks close to the work so completion is based on evidence, not a guess.'],
  ['Real work', 'Move from conversation to useful output with the Chat and Work surfaces already in the product.'],
] as const;

const FAQ = [
  ['What is a task?', 'A task is a unit of Work that is charged after verified success.'],
  ['What does the registry number mean?', '4,001 is the current registered agent-contract count. It describes available capability, not active or earning agents.'],
  ['Can I start without a card?', 'Yes. The Free plan starts at $0 and includes a 30-day trial with 5 tasks.'],
  ['What happens when work is not verified?', 'A Work task is not treated as complete until its success check passes; failed Work tasks return reserved credit.'],
] as const;

function TrialLink({ children = 'Start Free Trial' }: { children?: ReactNode }) {
  return <a className={styles.primaryButton} href="/signup">{children}<ArrowRight size={16} aria-hidden="true" /></a>;
}

export function CinematicLanding() {
  return (
    <div className={styles.root}>
      <header className={styles.nav}>
        <a className={styles.brand} href="/" aria-label="AKBARAL! home">AKBARAL!</a>
        <nav className={styles.navActions} aria-label="Landing navigation">
          <a href="#pricing">See plans and pricing</a><a href="/signin">Sign in</a><TrialLink />
        </nav>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="landing-title">
          <p className={styles.eyebrow}>A clearer way to get work done</p>
          <h1 id="landing-title">One Intelligence.<br /><span>Every Solution.</span></h1>
          <p className={styles.lead}>Describe the outcome you need. AKBARAL! turns your request into an inspectable plan, coordinates specialist contracts, and keeps verification close to the result.</p>
          <div className={styles.actions}><TrialLink /><a className={styles.secondaryButton} href="#pricing">See Plans</a></div>
          <div className={styles.heroProduct} aria-label="Chat and Work product preview">
            <div className={styles.productBar}><span className={styles.dot} /> MASTER · active request <span className={styles.productStatus}>verified</span></div>
            <div className={styles.productGrid}><div><p className={styles.miniLabel}>CHAT</p><p className={styles.message}>Prepare a launch brief for our next release.</p><p className={styles.messageMuted}>I’ll plan the work, route the contracts, and verify the deliverable.</p></div><div className={styles.workPanel}><p className={styles.miniLabel}>WORK</p><p><CheckCircle2 size={15} /> Brief structure checked</p><p><CheckCircle2 size={15} /> Source notes attached</p><p><CheckCircle2 size={15} /> Ready for review</p></div></div>
          </div>
        </section>

        <section className={styles.chips} aria-labelledby="suggestions-title"><p id="suggestions-title" className={styles.eyebrow}>Start with a suggestion</p><div>{['Draft a product brief', 'Compare two approaches', 'Organize my next steps', 'Review this work'].map((label) => <a key={label} href="/signup">{label}<ArrowRight size={14} aria-hidden="true" /></a>)}</div></section>

        <section id="features" className={styles.section} aria-labelledby="features-title"><p className={styles.eyebrow}>What changes</p><h2 id="features-title">From a loose request to a finished result.</h2><div className={styles.featureGrid}>{FEATURES.map(([title, copy]) => <article key={title}><span className={styles.number}>0{FEATURES.findIndex((item) => item[0] === title) + 1}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>

        <section className={styles.sectionAlt} aria-labelledby="integrations-title"><div><p className={styles.eyebrow}>Integrations</p><h2 id="integrations-title">Designed around the surfaces already here.</h2><p>Chat is the place to shape the request. Work is the place to track execution, evidence, and the final result. The experience stays inside AKBARAL! and uses the product’s existing workspace.</p></div><div className={styles.surfaceList}><span>Chat</span><span>Work</span><span>Verification</span></div></section>

        <section className={styles.demo} aria-labelledby="demo-title"><div className={styles.demoCopy}><p className={styles.eyebrow}>A thread with a next step</p><h2 id="demo-title">The conversation stays useful.</h2><p>MASTER keeps the goal visible while each Work task moves through planning, execution, and verification.</p></div><div className={styles.thread}><div className={styles.threadLine}><b>You</b><span>Turn these notes into a clear launch checklist.</span></div><div className={styles.threadLine}><b>MASTER</b><span>Plan created · 3 Work tasks · verification required</span></div><div className={styles.threadTask}><span>WORK TASK 02</span><strong>Structure launch checklist</strong><small><CheckCircle2 size={14} /> verified result attached</small></div></div></section>

        <section className={styles.section} aria-labelledby="agents-title"><p className={styles.eyebrow}>Agent team</p><h2 id="agents-title">Capability you can inspect.</h2><p className={styles.wideCopy}><strong>4,001 registered agent contracts</strong> span 80 specialist categories. That is a registry count of available contracts, not a claim that all agents are active or earning.</p></section>

        <section className={styles.security} aria-labelledby="security-title"><ShieldCheck size={28} aria-hidden="true" /><div><p className={styles.eyebrow}>Security note</p><h2 id="security-title">Evidence-led, with no invented promises.</h2><p>The product keeps provider credentials out of the UI and reports only configured or unconfigured status. Work completion is tied to verification.</p></div></section>

        <section className={styles.section} aria-labelledby="started-title"><p className={styles.eyebrow}>Get started</p><h2 id="started-title">Three steps to your first result.</h2><ol className={styles.getStarted}><li><b>01</b><div><h3>State the goal</h3><p>Tell Chat what outcome you need.</p><TrialLink>Start in Chat</TrialLink></div></li><li><b>02</b><div><h3>Review the plan</h3><p>See the proposed Work tasks and checks.</p><a href="/signup">Create your workspace <ArrowRight size={15} /></a></div></li><li><b>03</b><div><h3>Verify the result</h3><p>Use the evidence to decide what is ready.</p><a href="#pricing">See plans <ArrowRight size={15} /></a></div></li></ol></section>

        <section className={styles.faq} aria-labelledby="faq-title"><p className={styles.eyebrow}>Questions</p><h2 id="faq-title">A few useful answers.</h2>{FAQ.map(([question, answer]) => <details key={question}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</section>

        <section id="pricing" className={styles.pricing} aria-labelledby="pricing-title"><p className={styles.eyebrow}>Simple plans · USD</p><h2 id="pricing-title">Choose how much Work you need.</h2><p className={styles.pricingIntro}>Six plans, with task counts shown plainly.</p><div className={styles.planGrid}>{PLANS.map(([name, price, tasks, note]) => <article key={name}><h3>{name}</h3><strong>{price}<small>/mo</small></strong><p>{tasks}</p><span>{note}</span><a href="/signup">Choose {name}<ArrowRight size={15} /></a></article>)}</div></section>

        <section className={styles.finalCta} aria-labelledby="final-title"><Sparkles size={25} aria-hidden="true" /><h2 id="final-title">Start with one goal.</h2><p>One Intelligence. Every Solution.</p><TrialLink /></section>
      </main>
      <footer className={styles.footer}><a className={styles.brand} href="/">AKBARAL!</a><span>One Intelligence. Every Solution.</span><nav aria-label="Footer"><a href="#pricing">Pricing</a><a href="#features">Features</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/security">Security</a></nav><small>4,001 registered agent contracts · built for real execution</small></footer>
    </div>
  );
}
