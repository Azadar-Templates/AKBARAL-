'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Monitor, Sparkles } from 'lucide-react';
import { Button, Container } from '../ui';
import styles from './cinematic-landing.module.css';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const PLANS = [
  ['Free', '$0', '5 tasks', '30-day trial'],
  ['Starter', '$10', '25 tasks', 'For focused work'],
  ['Pro', '$50', '100 tasks', 'For professionals'],
  ['Business', '$90', '250 tasks', 'For growing teams'],
  ['Scale', '$200', '750 tasks', 'For high-volume work'],
  ['Enterprise', '$400', '2,000 tasks', 'For organizations'],
] as const;

const NARRATIVE = [
  ['walk', 'Approach', 'Bring one clear goal.'],
  ['power', 'Connect', 'MASTER turns the goal into an inspectable plan.'],
  ['work', 'Build', 'Specialist contracts execute with visible progress.'],
  ['handoff', 'Handoff', 'Verified work arrives ready to use.'],
] as const;

export function CinematicLanding() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!root.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const context = gsap.context(() => {
      gsap.to(`.${styles.progressBar}`, {
        scaleX: 1,
        ease: 'none',
        scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom bottom', scrub: 0.2 },
      });
      gsap.fromTo(`.${styles.figure}`, { xPercent: -22 }, {
        xPercent: 34,
        ease: 'none',
        scrollTrigger: { trigger: `.${styles.story}`, start: 'top 80%', end: '35% 45%', scrub: 0.45 },
      });
      gsap.fromTo(`.${styles.screenGlow}`, { opacity: 0.08 }, {
        opacity: 1,
        scrollTrigger: { trigger: '[data-narrative="power"]', start: 'top 70%', end: 'bottom 45%', scrub: 0.35 },
      });
      gsap.from(`.${styles.pipelineChip}`, {
        opacity: 0.3,
        y: 8,
        stagger: 0.12,
        scrollTrigger: { trigger: '[data-narrative="work"]', start: 'top 68%', toggleActions: 'play none none reverse' },
      });
      gsap.fromTo(`.${styles.resultCard}`, { opacity: 0, y: 12 }, {
        opacity: 1,
        y: 0,
        scrollTrigger: { trigger: '[data-narrative="handoff"]', start: 'top 68%', toggleActions: 'play none none reverse' },
      });
    }, root);
    requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => context.revert();
  }, { scope: root });

  const startTrial = () => { window.location.hash = '/register'; };
  const seePlans = () => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div ref={root} className={styles.root}>
      <div className={styles.progress} aria-hidden="true"><span className={styles.progressBar} /></div>

      <nav className={styles.nav} aria-label="Landing navigation">
        <a className={styles.brand} href="#/" aria-label="AKBARAL! home">AKBARAL!</a>
        <div className={styles.navActions}>
          <a href="#/login">Sign in</a>
          <button type="button" onClick={startTrial}>Start Free Trial</button>
        </div>
      </nav>

      <main>
        <section className={styles.hero} aria-labelledby="landing-title">
          <Container className={styles.heroInner}>
            <p className={styles.kicker}>AKBARAL!</p>
            <h1 id="landing-title">One Intelligence.<br /><span>Every Solution.</span></h1>
            <p className={styles.lead}>Describe the outcome. AKBARAL! plans the work, routes the right specialist contracts, executes real tools and verifies the result.</p>
            <div className={styles.heroActions}>
              <Button size="lg" onClick={startTrial}>Start Free Trial <ArrowRight size={17} /></Button>
              <Button size="lg" variant="secondary" onClick={seePlans}>See Plans</Button>
            </div>
            <p className={styles.registryNote}><strong>4,001</strong> registered agent contracts across 80 specialist categories. Registry size describes available capability, not active or earning agents.</p>
          </Container>
        </section>

        <section className={styles.how} aria-labelledby="how-title">
          <Container>
            <p className={styles.sectionLabel}>How it works</p>
            <h2 id="how-title">One request. Three clear steps.</h2>
            <ol className={styles.steps}>
              <li><span>01</span><div><h3>Plan</h3><p>Your goal becomes an inspectable sequence with success checks.</p></div></li>
              <li><span>02</span><div><h3>Build</h3><p>Only the specialist contracts required for the work are routed.</p></div></li>
              <li><span>03</span><div><h3>Verify</h3><p>Evidence gates completion; failed Work tasks return reserved credit.</p></div></li>
            </ol>
          </Container>
        </section>

        <section className={styles.story} aria-labelledby="story-title">
          <div className={styles.storyStage} aria-hidden="true">
            <div className={styles.roomLine} />
            <div className={styles.figure}><span className={styles.head} /><span className={styles.body} /><span className={styles.legs} /></div>
            <div className={styles.desk}><span className={styles.deskTop} /><span className={styles.deskLeg} /></div>
            <div className={styles.computer}>
              <Monitor className={styles.monitorIcon} />
              <div className={styles.screenGlow}>
                <span className={styles.screenLabel}>MASTER</span>
                <div className={styles.pipeline}>
                  <span className={styles.pipelineChip}>Planning</span>
                  <span className={styles.pipelineChip}>Building</span>
                  <span className={styles.pipelineChip}>Verifying</span>
                </div>
                <motion.div className={styles.resultCard} transition={{ duration: 0.3 }}>
                  <Check size={14} /><span>Result ready</span>
                </motion.div>
              </div>
            </div>
          </div>
          <Container className={styles.storyCopy}>
            <header><p className={styles.sectionLabel}>A visible path from goal to result</p><h2 id="story-title">Watch the work take shape.</h2></header>
            {NARRATIVE.map(([marker, title, detail], index) => (
              <article key={marker} data-narrative={marker} className={styles.storyBeat}>
                <span>0{index + 1}</span><div><h3>{title}</h3><p>{detail}</p></div>
              </article>
            ))}
          </Container>
        </section>

        <section id="pricing" className={styles.pricing} aria-labelledby="pricing-title">
          <Container>
            <div className={styles.pricingHead}><p className={styles.sectionLabel}>Simple plans · USD</p><h2 id="pricing-title">Choose how much Work you need.</h2><p>Work tasks are charged only after verified success. External compute remains subject to fair-use and provider limits.</p></div>
            <div className={styles.planGrid}>
              {PLANS.map(([name, price, tasks, note], index) => (
                <article key={name} className={index === 2 ? styles.featuredPlan : undefined}>
                  {index === 2 && <em>Most popular</em>}
                  <h3>{name}</h3><strong>{price}<small>/mo</small></strong><p>{tasks}</p><span>{note}</span>
                  <button type="button" onClick={startTrial}>{index === 0 ? 'Start Free Trial' : `Choose ${name}`}<ArrowRight size={15} /></button>
                </article>
              ))}
            </div>
          </Container>
        </section>

        <section className={styles.handoff} data-narrative-focus="cta" aria-labelledby="handoff-title">
          <Sparkles aria-hidden="true" /><h2 id="handoff-title">Start with one goal.</h2><p>One Intelligence. Every Solution.</p>
          <Button size="lg" onClick={startTrial}>Start Free Trial <ArrowRight size={17} /></Button>
          <small>No card required · 5 successful Work tasks · 30 days</small>
        </section>
      </main>

      <footer className={styles.footer}><span>AKBARAL!</span><p>One Intelligence. Every Solution.</p><nav aria-label="Footer"><a href="/about">About</a><a href="/security">Security</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav></footer>
    </div>
  );
}
