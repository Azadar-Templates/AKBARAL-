import tls from 'node:tls';
import net from 'node:net';

/**
 * Minimal honest SMTP sender for workforce transactional email.
 * No fake "sent" states: without SMTP_HOST/SMTP_USER/SMTP_PASS it throws
 * provider_not_configured; any protocol failure throws with the real error.
 * Supports STARTTLS (port 587) and implicit TLS (port 465).
 */

function smtpEnv(): { host: string; port: number; user: string; pass: string; from: string; secure: boolean } {
  const host = (process.env.SMTP_HOST ?? '').trim();
  const user = (process.env.SMTP_USER ?? '').trim();
  const pass = (process.env.SMTP_PASS ?? '').trim();
  if (!host || !user || !pass) {
    const error = new Error('workforce email requires SMTP_HOST, SMTP_USER and SMTP_PASS') as Error & { code?: string };
    error.code = 'provider_not_configured';
    throw error;
  }
  const port = Number(process.env.SMTP_PORT ?? 587) || 587;
  return { host, port, user, pass, from: (process.env.SMTP_FROM ?? 'Akbaral <no-reply@akbaral.ai>').trim(), secure: port === 465 };
}

function smtpCommand(socket: net.Socket | tls.TLSSocket, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      // Multi-line replies end with "<code> <text>".
      if (/\r\n\d{3} [^\r\n]*\r\n$/.test(buffer) || /^\d{3} [^\r\n]*\r\n$/.test(buffer)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`SMTP timeout waiting for reply to: ${command.slice(0, 40)}`)); }, 15_000);
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
    socket.write(`${command}\r\n`);
  });
}

function readGreeting(socket: net.Socket | tls.TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => { cleanup(); reject(new Error('SMTP timeout waiting for greeting')); }, 15_000);
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      if (buffer.includes('\r\n')) { cleanup(); resolve(buffer); }
    };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

function smtpCode(reply: string): number {
  const match = reply.match(/(\d{3})[ -]/);
  return match ? Number(match[1]) : 0;
}

export async function sendWorkforceEmail(input: { to: string; subject: string; text: string }): Promise<string> {
  const config = smtpEnv();
  const to = input.to.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    throw new Error('invalid recipient email address');
  }
  const connect = (): Promise<net.Socket | tls.TLSSocket> =>
    new Promise((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      if (config.secure) {
        const socket = tls.connect({ host: config.host, port: config.port, servername: config.host }, () => {
          socket.off('error', onError);
          resolve(socket);
        });
        socket.on('error', onError);
      } else {
        const socket = net.connect({ host: config.host, port: config.port }, () => {
          socket.off('error', onError);
          resolve(socket);
        });
        socket.on('error', onError);
      }
    });

  let socket: net.Socket | tls.TLSSocket | null = null;
  try {
    socket = await connect();
    const greeting = await readGreeting(socket);
    if (smtpCode(greeting) !== 220) throw new Error(`SMTP greeting rejected: ${greeting.slice(0, 120)}`);
    const ehlo = await smtpCommand(socket, `EHLO ${config.host}`);
    if (smtpCode(ehlo) !== 250) throw new Error(`SMTP EHLO rejected: ${ehlo.slice(0, 120)}`);
    if (!config.secure && /STARTTLS/i.test(ehlo)) {
      const start = await smtpCommand(socket, 'STARTTLS');
      if (smtpCode(start) !== 220) throw new Error(`SMTP STARTTLS rejected: ${start.slice(0, 120)}`);
      const secured = tls.connect({ socket: socket as net.Socket, servername: config.host });
      await new Promise<void>((resolve, reject) => {
        secured.on('secureConnect', () => resolve());
        secured.on('error', reject);
      });
      socket = secured;
      const ehlo2 = await smtpCommand(socket, `EHLO ${config.host}`);
      if (smtpCode(ehlo2) !== 250) throw new Error(`SMTP EHLO (TLS) rejected: ${ehlo2.slice(0, 120)}`);
    }
    const userB64 = Buffer.from(config.user, 'utf8').toString('base64');
    const passB64 = Buffer.from(config.pass, 'utf8').toString('base64');
    const auth = await smtpCommand(socket, 'AUTH LOGIN');
    if (smtpCode(auth) !== 334) throw new Error(`SMTP AUTH rejected: ${auth.slice(0, 120)}`);
    const u = await smtpCommand(socket, userB64);
    if (smtpCode(u) !== 334) throw new Error(`SMTP username rejected: ${u.slice(0, 120)}`);
    const p = await smtpCommand(socket, passB64);
    if (smtpCode(p) !== 235) throw new Error('SMTP authentication failed (check SMTP_USER/SMTP_PASS)');
    const fromMatch = config.from.match(/<([^>]+)>/) ?? [null, config.from];
    const fromAddr = (fromMatch[1] ?? config.from).trim();
    const mf = await smtpCommand(socket, `MAIL FROM:<${fromAddr}>`);
    if (smtpCode(mf) !== 250) throw new Error(`SMTP MAIL FROM rejected: ${mf.slice(0, 120)}`);
    const rc = await smtpCommand(socket, `RCPT TO:<${to}>`);
    if (![250, 251].includes(smtpCode(rc))) throw new Error(`SMTP RCPT TO rejected: ${rc.slice(0, 120)}`);
    const dt = await smtpCommand(socket, 'DATA');
    if (smtpCode(dt) !== 354) throw new Error(`SMTP DATA rejected: ${dt.slice(0, 120)}`);
    const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${config.host}>`;
    const body = [
      `From: ${config.from}`,
      `To: ${to}`,
      `Subject: ${input.subject.slice(0, 200)}`,
      `Message-ID: ${messageId}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      input.text.slice(0, 20_000),
      '.',
    ].join('\r\n');
    const sent = await smtpCommand(socket, body);
    if (smtpCode(sent) !== 250) throw new Error(`SMTP message rejected: ${sent.slice(0, 200)}`);
    try { await smtpCommand(socket, 'QUIT'); } catch { /* best-effort */ }
    return `smtp:${messageId}`;
  } finally {
    socket?.destroy();
  }
}
