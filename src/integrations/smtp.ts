import net from 'node:net';
import tls from 'node:tls';
import { env } from '../config/env';

/**
 * Minimal SMTP client for account-recovery/verification email delivery.
 *
 * Supports:
 *   - implicit TLS (port 465), explicit STARTTLS (port 587/25), or plaintext
 *     for trusted local test relays;
 *   - AUTH PLAIN and AUTH LOGIN;
 *   - a configurable timeout;
 *   - safe, secret-free errors (no password is ever part of an error message).
 *
 * If SMTP is not configured it fails honestly with
 * `email_delivery_not_configured` and the required variable names.
 */

export class EmailDeliveryNotConfiguredError extends Error {
  readonly code = 'email_delivery_not_configured';
  readonly requiredCredential = 'SMTP_HOST/SMTP_USER/SMTP_PASSWORD';
  constructor() {
    super('email delivery requires SMTP_HOST, SMTP_USER and SMTP_PASSWORD');
    this.name = 'EmailDeliveryNotConfiguredError';
  }
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  timeoutMs: number;
}

interface Reply {
  code: number;
  lines: string[];
}

function resolveSmtpConfig(): SmtpConfig {
  const host = (process.env.SMTP_HOST ?? '').trim();
  const user = (process.env.SMTP_USER ?? '').trim();
  const password = process.env.SMTP_PASSWORD ?? '';
  if (!host || !user || !password) {
    throw new EmailDeliveryNotConfiguredError();
  }
  const rawPort = Number(process.env.SMTP_PORT ?? (process.env.SMTP_SECURE === '1' ? '465' : '587'));
  const port = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : 587;
  const secure = port === 465 || process.env.SMTP_SECURE === '1';
  return {
    host,
    port,
    secure,
    user,
    password,
    from: env.smtpFrom,
    timeoutMs: Math.max(5_000, Number(process.env.SMTP_TIMEOUT_MS ?? 10_000)),
  };
}

async function readReply(socket: net.Socket, timeoutMs: number): Promise<Reply> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('SMTP reply timed out'));
    }, timeoutMs);

    const cleanup = () => clearTimeout(timer);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (lines.length === 0) {
        return;
      }
      const last = lines[lines.length - 1];
      const match = /^(\d{3})(?:[ -])(.*)$/.exec(last);
      if (!match) {
        return;
      }
      const code = Number(match[1]);
      const complete = /^(\d{3}) /.test(last);
      if (complete || lines.length > 1) {
        cleanup();
        socket.removeListener('data', onData);
        resolve({ code, lines });
      }
    };
    socket.on('data', onData);
    socket.once('error', (error) => {
      cleanup();
      reject(error);
    });
  });
}

function send(socket: net.Socket, line: string): void {
  socket.write(`${line}\r\n`);
}

function connect(config: SmtpConfig): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = config.secure
      ? tls.connect({ host: config.host, port: config.port, servername: config.host })
      : net.createConnection({ host: config.host, port: config.port });
    socket.setTimeout(config.timeoutMs, () => socket.destroy(new Error('SMTP connection timed out')));
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.removeListener('error', reject);
      resolve(socket);
    });
    socket.once('secureConnect', () => {
      if (config.secure) {
        socket.removeListener('error', reject);
        resolve(socket);
      }
    });
  });
}

function upgradeToTls(socket: net.Socket, config: SmtpConfig): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const upgraded = tls.connect({ socket, servername: config.host });
    upgraded.once('secureConnect', () => resolve(upgraded));
    upgraded.once('error', reject);
  });
}

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ messageId: string }> {
  const config = resolveSmtpConfig();
  let socket = await connect(config);
  try {
    let greeting = await readReply(socket, config.timeoutMs);
    if (greeting.code !== 220) {
      throw new Error(`SMTP greeting refused (HTTP-equivalent ${greeting.code})`);
    }

    const ehloHost = (process.env.SMTP_EHLO || 'akbaral.local').trim();
    send(socket, `EHLO ${ehloHost}`);
    let ehlo = await readReply(socket, config.timeoutMs);
    if (ehlo.code !== 250) {
      throw new Error('SMTP EHLO refused');
    }
    const capabilities = ehlo.lines.join('\n').toUpperCase();

    if (!config.secure && capabilities.includes('STARTTLS')) {
      send(socket, 'STARTTLS');
      const starttls = await readReply(socket, config.timeoutMs);
      if (starttls.code !== 220) {
        throw new Error('SMTP STARTTLS refused');
      }
      socket = await upgradeToTls(socket, config);
      send(socket, `EHLO ${ehloHost}`);
      ehlo = await readReply(socket, config.timeoutMs);
      if (ehlo.code !== 250) {
        throw new Error('SMTP re-EHLO after STARTTLS refused');
      }
    }

    const authCapabilities = ehlo.lines.join('\n').toUpperCase();
    if (authCapabilities.includes('AUTH PLAIN')) {
      send(socket, `AUTH PLAIN ${base64(`\0${config.user}\0${config.password}`)}`);
    } else {
      send(socket, 'AUTH LOGIN');
      const login = await readReply(socket, config.timeoutMs);
      if (login.code !== 334) {
        throw new Error('SMTP AUTH LOGIN refused');
      }
      send(socket, base64(config.user));
      const userReply = await readReply(socket, config.timeoutMs);
      if (userReply.code !== 334) {
        throw new Error('SMTP AUTH LOGIN username refused');
      }
      send(socket, base64(config.password));
    }
    const auth = await readReply(socket, config.timeoutMs);
    if (auth.code !== 235) {
      throw new Error('SMTP authentication failed');
    }

    const envelopeFrom = parseAddress(config.from);
    const envelopeTo = parseAddress(input.to);
    send(socket, `MAIL FROM:<${envelopeFrom}>`);
    const mail = await readReply(socket, config.timeoutMs);
    if (mail.code !== 250) {
      throw new Error('SMTP MAIL FROM refused');
    }
    send(socket, `RCPT TO:<${envelopeTo}>`);
    const rcpt = await readReply(socket, config.timeoutMs);
    if (rcpt.code !== 250 && rcpt.code !== 251) {
      throw new Error('SMTP RCPT TO refused');
    }

    send(socket, 'DATA');
    const data = await readReply(socket, config.timeoutMs);
    if (data.code !== 354) {
      throw new Error('SMTP DATA refused');
    }

    const date = new Date().toUTCString();
    const messageId = `<akbaral-${Date.now()}@${ehloHost}>`;
    const headers = [
      `From: ${config.from}`,
      `To: ${input.to}`,
      `Subject: ${sanitizeHeader(input.subject)}`,
      `Content-Type: ${input.html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8'}`,
      `Date: ${date}`,
      `Message-Id: ${messageId}`,
      'MIME-Version: 1.0',
      '',
    ].join('\r\n');
    const body = `${headers}${input.html ?? input.text}\r\n.`;
    send(socket, body);
    const accepted = await readReply(socket, config.timeoutMs);
    if (accepted.code !== 250) {
      throw new Error('SMTP message not accepted');
    }
    send(socket, 'QUIT');
    try {
      await readReply(socket, config.timeoutMs);
    } catch {
      // QUIT reply is best-effort; the message was accepted.
    }
    return { messageId };
  } finally {
    socket.destroy();
  }
}

export function smtpConfigured(): boolean {
  return Boolean((process.env.SMTP_HOST ?? '').trim() && (process.env.SMTP_USER ?? '').trim() && process.env.SMTP_PASSWORD);
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]/g, ' ').slice(0, 200);
}

function parseAddress(value: string): string {
  const match = /^[^<]*<([^>]+)>$/.exec(value.trim());
  const email = match ? match[1] : value.trim();
  return email.replace(/[\r\n]/g, '').slice(0, 254);
}
