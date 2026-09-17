import type { Metadata } from 'next';
import { SitePage } from '../../_components/site-chrome';

export const metadata: Metadata = {
  title: 'Help Center — AKBARAL!',
  description:
    'How AKBARAL! works: submitting goals, the task lifecycle, credits and the free-task rule, agents, the Agent Factory, troubleshooting common errors, and how to get support.',
};

export default function HelpPage() {
  return (
    <SitePage currentPath="/help">
      <section className="pk-hero">
        <span className="pk-kicker">Help</span>
        <h1>How AKBARAL! actually works</h1>
        <p>Everything below describes the real implementation — the same rules the engine enforces.</p>
      </section>
      <div className="pk-page">
        <div className="pk-prose">
          <h2>Submitting a goal</h2>
          <p>
            Sign in and open <strong>MASTER</strong>. Describe what you want in plain language —
            the more context (audience, format, constraints), the better the plan. You can
            attach files (documents, data, images) to give agents source material, and save
            work into projects to keep related tasks together.
          </p>

          <h2>The task lifecycle</h2>
          <p>Every task moves through visible stages:</p>
          <ul>
            <li><strong>UNDERSTANDING</strong> — the goal analyzer classifies your goal and its constraints.</li>
            <li><strong>PLANNING</strong> — the planner writes a step-by-step workflow you can inspect.</li>
            <li><strong>RESEARCHING</strong> — research agents gather sources when the task needs them.</li>
            <li><strong>SELECTING AGENTS</strong> — the router picks specialists from the registry; you see who and why.</li>
            <li><strong>EXECUTING</strong> — agents work with real tools; progress streams live and steps are inspectable.</li>
            <li><strong>VERIFYING</strong> — results are checked against the plan before completion.</li>
            <li><strong>COMPLETED / FAILED</strong> — you get the result plus the full execution record, or an honest failure with reasons.</li>
          </ul>
          <p>
            Failed tasks can be retried from the task view. The execution queue is durable —
            if the platform restarts mid-task, recovery and reconciliation pick the work back up.
          </p>

          <h2>Credits and the free-task rule</h2>
          <ul>
            <li>A task credit is consumed <strong>only after successful completion</strong>.</li>
            <li>If a task fails or cannot be completed, the credit is restored automatically.</li>
            <li>If a task needs a resource your plan does not include, you are told before spending anything.</li>
            <li>The Free trial includes 5 tasks and lasts 30 days — no card required.</li>
          </ul>

          <h2>Agents and the Agent Factory</h2>
          <p>
            <a href="/agents">Agent World</a> lists all 4,001 registry specialists — search,
            filter by category, and inspect any agent&apos;s contract. To build your own, see the
            <a href="/agent-factory"> Agent Factory</a> page: definitions, testing, versioning and
            a governed publish lifecycle.
          </p>

          <h2>Common errors and what they mean</h2>
          <ul>
            <li><strong>“No provider available for this task”</strong> — the model providers that
              this task requires are not configured on the platform right now. Nothing was
              charged. This is the honest-availability rule: AKBARAL! never pretends a provider
              is live when it is not.</li>
            <li><strong>“Task failed: &lt;reason&gt;”</strong> — the engine could not complete the
              task (for example, a source was unreachable). Your credit was restored; press
              Retry to try again.</li>
            <li><strong>“Rate limit exceeded”</strong> — too many requests in a minute. Wait a
              moment and retry; limits protect the shared infrastructure.</li>
            <li><strong>Upload rejected</strong> — the file type or size is outside the allowed
              range (upload validation is enforced for security).</li>
          </ul>

          <h2>Getting support</h2>
          <p>
            Use the in-app <strong>Feedback</strong> form (choose the matching category —
            including a security category) or the public
            <a href="/contact"> contact page</a>. Feedback is stored and reviewed by the team;
            you can see the status of your own submissions in the app.
          </p>
        </div>
      </div>
    </SitePage>
  );
}
