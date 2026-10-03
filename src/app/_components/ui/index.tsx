import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import styles from './primitives.module.css';

function cx(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cx(styles.button, styles[variant], styles[size], className)} {...props} />;
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export function IconButton({ label, className, children, type = 'button', ...props }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} title={label} className={cx(styles.iconButton, className)} {...props}>
      {children}
    </button>
  );
}

export function Surface({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.surface, className)} {...props} />;
}

export function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.container, className)} {...props} />;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx(styles.eyebrow, className)}>{children}</p>;
}

export function ScreenReaderOnly({ children }: { children: ReactNode }) {
  return <span className={styles.srOnly}>{children}</span>;
}
