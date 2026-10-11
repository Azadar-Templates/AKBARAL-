import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import styles from './primitives.module.css';

function cx(...values: Array<string | undefined | false>): string { return values.filter(Boolean).join(' '); }

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; }
export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...props }: ButtonProps) { return <button type={type} className={cx(styles.button, styles[variant], styles[size], className)} {...props} />; }

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { label: string; }
export function IconButton({ label, className, children, type = 'button', ...props }: IconButtonProps) { return <button type={type} aria-label={label} title={label} className={cx(styles.iconButton, className)} {...props}>{children}</button>; }

export function Surface({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cx(styles.surface, className)} {...props} />; }
export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) { return <section className={cx(styles.panel, className)} {...props} />; }
export function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cx(styles.container, className)} {...props} />; }
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) { return <p className={cx(styles.eyebrow, className)}>{children}</p>; }
export function StatusBadge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'active' | 'success' | 'warning' | 'error' | 'neutral'; className?: string }) { return <span className={cx(styles.status, styles[tone], className)}>{children}</span>; }
export function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) { return <label className={cx(styles.field, className)}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>; }
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) { return <input className={cx(styles.input, className)} {...props} />; }
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) { return <select className={cx(styles.input, className)} {...props} />; }
/** One banner: a strip that states a state, never a decoration. */
export function Banner({ tone = 'info', className, ...props }: HTMLAttributes<HTMLDivElement> & { tone?: 'info' | 'warn' | 'bad' | 'good' }) {
  return <div role="status" className={cx(styles.banner, tone !== 'info' ? styles[tone] : undefined, className)} {...props} />;
}

/** One empty state: the honest sentence, plus the one action that fills it. */
export function EmptyState({ title, hint, action, className }: { title: string; hint?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cx(styles.emptyState, className)}>
      <strong>{title}</strong>
      {hint ? <span>{hint}</span> : null}
      {action ? <span className={styles.emptyAction}>{action}</span> : null}
    </div>
  );
}

/** One table: header, rows and its own horizontal containment. */
export function Table({ head, rows, caption, className }: { head: readonly string[]; rows: readonly ReactNode[][]; caption?: string; className?: string }) {
  return (
    <div className={cx(styles.tableWrap, className)}>
      <table className={styles.table}>
        {caption ? <caption>{caption}</caption> : null}
        <thead><tr>{head.map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, at) => <td key={at}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** One section head: title, one line of purpose, one action. */
export function SectionHead({ title, intro, action, className }: { title: string; intro?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cx(styles.sectionHead, className)}>
      <div>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {intro ? <p className={styles.sectionIntro}>{intro}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** One page-level title. A page states what it is for in the line under it. */
export function PageTitle({ children, intro, className }: { children: ReactNode; intro?: string; className?: string }) {
  return (
    <header className={cx(styles.sectionHead, className)}>
      <div>
        <h1 className={styles.sectionTitle}>{children}</h1>
        {intro ? <p className={styles.sectionIntro}>{intro}</p> : null}
      </div>
    </header>
  );
}

export function ScreenReaderOnly({ children }: { children: ReactNode }) { return <span className={styles.srOnly}>{children}</span>; }
