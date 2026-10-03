'use client';

import { useRef, type CSSProperties } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowRight,
  Check,
  Code2,
  Download,
  FileSearch,
  Globe2,
  Layers3,
  LineChart,
  Play,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Button, Container, Eyebrow } from '../ui';
import styles from './cinematic-landing.module.css';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const PLAN_STEPS = [
  ['01', 'Define the outcome', 'A responsive launch page and working ROI calculator.'],
  ['02', 'Route specialists', 'Product strategy, interface design, engineering and QA.'],
  ['03', 'Build and verify', 'Create the files, run checks and package the result.'],
] as const;

const AGENTS = [
  ['Product', 'Intent'], ['Research', 'Sources'], ['Design', 'Interface'], ['Web', 'Build'],
  ['Data', 'Model'], ['QA', 'Verify'], ['Security', 'Review'], ['Delivery', 'Package'],
] as const;

const PLANS = [
  ['Free', '$0', '5 tasks', '30-day trial'],
  ['Starter', '$10', '25 tasks', 'For focused work'],
  ['Pro', '$50', '100 tasks', 'For professionals'],
  ['Business', '$90', '250 tasks', 'For growing teams'],
  ['Scale', '$200', '750 tasks', 'For high-volume work'],
  ['Enterprise', '$400', '2,000 tasks', 'For organizations'],
] as const;

export function CinematicLanding() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const element = root.current;
    if (!element) return;

    let initialized = false;
    let animationContext: gsap.Context | undefined;
    let observer: MutationObserver | undefined;

    const initialize = () => {
      if (initialized || !root.current) return;
      initialized = true;

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      animationContext = gsap.context(() => {
        gsap.to(`.${styles.progressBar}`, {
          scaleX: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: root.current,
            start: 'top top',
            end: 'bottom bottom',
            scrub: 0.2,
          },
        });

        gsap.utils.toArray<HTMLElement>('[data-cinematic-scene]').forEach((scene, index) => {
          const reveals = scene.querySelectorAll<HTMLElement>('[data-reveal]');
          if (index > 0 && reveals.length) {
            gsap.from(reveals, {
              y: 64,
              opacity: 0,
              duration: 1,
              stagger: 0.1,
              ease: 'power3.out',
              scrollTrigger: { trigger: scene, start: 'top 72%', once: true },
            });
          }

          const visual = scene.querySelector<HTMLElement>('[data-parallax]');
          if (visual) {
            gsap.fromTo(visual, { yPercent: -5 }, {
              yPercent: 5,
              ease: 'none',
              scrollTrigger: { trigger: scene, start: 'top bottom', end: 'bottom top', scrub: 0.6 },
            });
          }
        });

        gsap.to(`.${styles.agentNode}`, {
          y: -8,
          duration: 2.4,
          stagger: { each: 0.16, from: 'random' },
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
        });
      }, root);
      requestAnimationFrame(() => ScrollTrigger.refresh());
    };

    const screen = element.closest<HTMLElement>('.screen');
    if (!screen?.hidden) {
      initialize();
    } else {
      observer = new MutationObserver(() => {
        if (!screen.hidden) {
          observer?.disconnect();
          requestAnimationFrame(initialize);
        }
      });
      observer.observe(screen, { attributes: true, attributeFilter: ['hidden'] });
    }

    return () => {
      observer?.disconnect();
      animationContext?.revert();
    };
  }, { scope: root });

  const startTrial = () => { window.location.hash = '/register'; };
  const seePlans = () => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div ref={root} className={styles.root}>
      <div className={styles.progress} aria-hidden="true"><span className={styles.progressBar} /></div>
      <nav className={styles.sceneRail} aria-label="Landing page scenes">
        {['Intro', 'Understand', 'Plan', 'Route', 'Verify', 'Deliver'].map((label, index) => (
          <a key={label} href={`#scene-${index + 1}`}><span>0{index + 1}</span><b>{label}</b></a>
        ))}
      </nav>

      <section id="scene-1" className={`${styles.scene} ${styles.hero}`} data-cinematic-scene aria-labelledby="landing-title">
        <div className={styles.heroAtmosphere} aria-hidden="true">
          <div className={styles.orbitA} /><div className={styles.orbitB} /><div className={styles.intelligenceCore}>A!</div>
        </div>
        <Container className={styles.heroLayout}>
          <div className={styles.heroCopy}>
            <p className={`${styles.heroBrand} ${styles.heroMeta}`}>AKBARAL!</p>
            <Eyebrow className={styles.heroMeta}>The intelligence operating system</Eyebrow>
            <h1 id="landing-title" className={styles.heroTitle}>
              <span><i className={styles.heroWord}>One Intelligence.</i></span>
              <span><i className={`${styles.heroWord} ${styles.accentWord}`}>Every Solution.</i></span>
            </h1>
            <p className={`${styles.heroLead} ${styles.heroMeta}`}>
              Tell AKBARAL! what you need. One orchestration core understands the goal, builds the plan,
              routes specialist agents, executes real tools and verifies what comes back.
            </p>
            <div className={`${styles.actions} ${styles.heroMeta}`}>
              <Button size="lg" onClick={startTrial}>Start Free Trial <ArrowRight size={17} /></Button>
              <Button size="lg" variant="secondary" onClick={seePlans}>See Plans</Button>
            </div>
          </div>
          <div className={`${styles.heroIndex} ${styles.heroMeta}`} aria-label="Platform facts">
            <div><strong>4,001</strong><span>registered agent contracts</span></div>
            <div><strong>80</strong><span>specialist categories</span></div>
            <div><strong>01</strong><span>unified intelligence</span></div>
          </div>
        </Container>
        <a className={styles.scrollCue} href="#scene-2"><ArrowDown size={15} /><span>Follow the work</span></a>
      </section>

      <section id="scene-2" className={`${styles.scene} ${styles.lightScene}`} data-cinematic-scene aria-labelledby="understand-title">
        <Container className={styles.split}>
          <div className={styles.chapterCopy}>
            <Eyebrow data-reveal>01 — Understanding</Eyebrow>
            <h2 id="understand-title" data-reveal>It starts with what you mean—not which tool to open.</h2>
            <p data-reveal>MASTER turns an ordinary request into a clear objective, constraints and deliverables before work begins.</p>
            <div className={styles.chapterNote} data-reveal><FileSearch size={18} /><span>Intent and constraints remain visible throughout the run.</span></div>
          </div>
          <div className={styles.intentStage} data-parallax>
            <div className={styles.requestCard} data-reveal>
              <small>Your goal</small>
              <p>“Launch a polished site for my service and add a calculator that explains the value.”</p>
            </div>
            <div className={styles.intentResult} data-reveal>
              <span>Objective <b>Qualified</b></span>
              <ul><li>Responsive website</li><li>Interactive ROI model</li><li>Downloadable source</li></ul>
            </div>
          </div>
        </Container>
        <span className={styles.sceneNumber} aria-hidden="true">01</span>
      </section>

      <section id="scene-3" className={`${styles.scene} ${styles.darkScene}`} data-cinematic-scene aria-labelledby="plan-title">
        <Container>
          <div className={styles.centerHeading}>
            <Eyebrow data-reveal>02 — Planning</Eyebrow>
            <h2 id="plan-title" data-reveal>A plan you can inspect before execution begins.</h2>
            <p data-reveal>Dependencies, ownership and success checks are arranged in order—not hidden behind a loading spinner.</p>
          </div>
          <ol className={styles.planTrack} data-parallax>
            {PLAN_STEPS.map(([number, title, detail]) => (
              <li key={number} data-reveal>
                <span>{number}</span><div><h3>{title}</h3><p>{detail}</p></div><Check aria-hidden="true" size={18} />
              </li>
            ))}
          </ol>
        </Container>
        <span className={styles.sceneNumber} aria-hidden="true">02</span>
      </section>

      <section id="scene-4" className={`${styles.scene} ${styles.constellationScene}`} data-cinematic-scene aria-labelledby="agents-title">
        <Container className={styles.split}>
          <div className={styles.chapterCopy}>
            <Eyebrow data-reveal>03 — Routing</Eyebrow>
            <h2 id="agents-title" data-reveal>The right specialists assemble around the work.</h2>
            <p data-reveal>AKBARAL! selects only the contracts required by the plan. Registry size is capability—not a claim that every agent is active.</p>
            <a className={styles.textLink} href="/agents" data-reveal>Explore the agent registry <ArrowRight size={16} /></a>
          </div>
          <div className={styles.constellation} data-parallax aria-label="Specialist agents routed around MASTER">
            <svg viewBox="0 0 600 600" aria-hidden="true"><circle cx="300" cy="300" r="190" /><circle cx="300" cy="300" r="112" />{AGENTS.map((_, i) => { const a=(i/AGENTS.length)*Math.PI*2; return <line key={i} x1="300" y1="300" x2={300+Math.cos(a)*190} y2={300+Math.sin(a)*190} />; })}</svg>
            <div className={styles.masterCore}><span>MASTER</span><b>Routing</b></div>
            {AGENTS.map(([name, skill], index) => (
              <div key={name} className={styles.agentNode} style={{ '--agent-index': index } as CSSProperties}>
                <b>{name}</b><small>{skill}</small>
              </div>
            ))}
          </div>
        </Container>
        <span className={styles.sceneNumber} aria-hidden="true">03</span>
      </section>

      <section id="scene-5" className={`${styles.scene} ${styles.executionScene}`} data-cinematic-scene aria-labelledby="execute-title">
        <Container>
          <div className={styles.executionHeading}>
            <div><Eyebrow data-reveal>04 — Execution & verification</Eyebrow><h2 id="execute-title" data-reveal>Real work. Visible evidence.</h2></div>
            <p data-reveal>Tools execute against the task, then verification gates completion. Failed work returns the reserved credit.</p>
          </div>
          <div className={styles.executionWindow} data-parallax data-reveal>
            <div className={styles.windowTop}><span /><span /><span /><b>MASTER / execution-4821</b><em>Live</em></div>
            <div className={styles.executionGrid}>
              <div className={styles.activityLog}>
                <article><Globe2 /><div><b>Website specialist</b><span>Building responsive page structure</span></div><small>done</small></article>
                <article><Code2 /><div><b>Application engineer</b><span>Implementing calculator logic</span></div><small>done</small></article>
                <article className={styles.activeLog}><ShieldCheck /><div><b>Verification specialist</b><span>Checking output against acceptance criteria</span></div><small>running</small></article>
              </div>
              <div className={styles.previewPane}>
                <div className={styles.previewToolbar}><span>Preview</span><button aria-label="Play preview"><Play size={14} /></button></div>
                <div className={styles.previewMock}><span>YOUR RETURN,</span><strong>made clear.</strong><div><i /><i /><i /></div></div>
              </div>
            </div>
          </div>
          <div className={styles.truthStrip} data-reveal><span><Check /> Success-only charging</span><span><ShieldCheck /> Evidence-gated completion</span><span><Layers3 /> Versioned artifacts</span></div>
        </Container>
        <span className={styles.sceneNumber} aria-hidden="true">04</span>
      </section>

      <section id="scene-6" className={`${styles.scene} ${styles.deliveryScene}`} data-cinematic-scene aria-labelledby="delivery-title">
        <Container>
          <div className={styles.deliveryTop}>
            <div className={styles.chapterCopy}>
              <Eyebrow data-reveal>05 — Delivery</Eyebrow>
              <h2 id="delivery-title" data-reveal>The conversation becomes something you can use.</h2>
              <p data-reveal>Sites, source files, research, applications and data-backed analysis arrive in one Work canvas, ready to preview and download.</p>
            </div>
            <div className={styles.artifactStack} data-parallax data-reveal>
              <motion.div className={styles.artifactMain} whileHover={{ y: -6 }} transition={{ duration: 0.2 }}><Globe2 /><span><b>launch-site</b><small>Live preview · 12 files</small></span><Download size={18} /></motion.div>
              <div className={styles.artifactCard}><Code2 /><span>Source package</span></div>
              <div className={styles.artifactCard}><LineChart /><span>ROI analysis</span></div>
            </div>
          </div>

          <div id="pricing" className={styles.pricing}>
            <div className={styles.pricingHead}><Eyebrow data-reveal>Simple plans</Eyebrow><h2 data-reveal>Choose how much work you need.</h2><p data-reveal>Work tasks are charged only after verified success. External compute remains subject to fair-use and provider limits.</p></div>
            <div className={styles.planGrid}>
              {PLANS.map(([name, price, tasks, note], index) => (
                <article key={name} className={index === 2 ? styles.featuredPlan : undefined} data-reveal>
                  {index === 2 ? <em>Most popular</em> : null}<h3>{name}</h3><strong>{price}<small>/mo</small></strong><p>{tasks}</p><span>{note}</span>
                  <button onClick={startTrial}>{index === 0 ? 'Start Free Trial' : `Choose ${name}`}<ArrowRight size={15} /></button>
                </article>
              ))}
            </div>
          </div>

          <div className={styles.finalCta} data-reveal>
            <Sparkles aria-hidden="true" />
            <Eyebrow>Start with one goal</Eyebrow>
            <h2>One Intelligence.<br />Every Solution.</h2>
            <Button size="lg" onClick={startTrial}>Start Free Trial <ArrowRight size={17} /></Button>
            <small>No card required · 5 successful Work tasks · 30 days</small>
          </div>
        </Container>
        <span className={styles.sceneNumber} aria-hidden="true">05</span>
      </section>
    </div>
  );
}
