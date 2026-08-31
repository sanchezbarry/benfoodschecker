import { Resend } from "resend";
import type { CertDocument } from "@/lib/types";
import { certLabel, daysUntil, formatDate } from "@/lib/utils";
import { APP_URL } from "@/lib/constants";

const FROM = process.env.EMAIL_FROM ?? "Cert Checker <onboarding@resend.dev>";

/**
 * Resend's sandbox sender (`onboarding@resend.dev`) may only deliver to the
 * address the Resend account was registered with. Until a sending domain is
 * verified, a reminder addressed to a real contact is refused outright, which
 * would leave the whole workflow silently failing.
 *
 * Setting EMAIL_REDIRECT_TO routes every message to that one deliverable
 * address instead, naming the intended recipient in the subject line and at the
 * top of the body. The point is to keep the workflow honest rather than to fake
 * delivery: nobody reading a redirected email should think it reached the
 * person it names. Leave it unset once a domain is verified.
 */
const REDIRECT_TO = process.env.EMAIL_REDIRECT_TO?.trim() ?? "";

type Routed = {
  to: string;
  cc?: string;
  subjectPrefix: string;
  notice: string;
};

function route(to: string, cc?: string | null): Routed {
  // No redirect configured, or it would land in the same inbox anyway.
  if (!REDIRECT_TO || to.trim().toLowerCase() === REDIRECT_TO.toLowerCase()) {
    return { to, ...(cc ? { cc } : {}), subjectPrefix: "", notice: "" };
  }
  const intended = cc ? `${to} (cc ${cc})` : to;
  return {
    to: REDIRECT_TO,
    // cc is dropped: it would be refused for exactly the same reason.
    subjectPrefix: `[for ${to}] `,
    notice: `<div style="margin:0 0 16px;padding:10px 12px;border:1px dashed ${C.line};border-radius:8px;background:${C.page};font-size:13px;color:${C.muted}">
        <strong style="color:${C.ink}">Redirected.</strong> This would normally be sent to ${intended}. All reminders are routed here while the sending domain is unverified.
      </div>`,
  };
}

/**
 * Ben Foods palette as plain hex — email clients don't understand the oklch
 * custom properties the app uses, so these mirror the tokens in globals.css.
 */
const C = {
  brand: "#1f9a3a", // published brand green, decorative only
  primary: "#007523", // darkened green — safe behind white button text
  red: "#c72031",
  orange: "#f4792d",
  ink: "#161816",
  muted: "#5f625f",
  line: "#dee0de",
  page: "#f1f3f1",
  card: "#ffffff",
};

/**
 * Delivery result, normalised so callers don't care which transport ran.
 * Mirrors the shape Resend already returned, so nothing downstream changed.
 */
export type SendResult = {
  data: { id: string } | null;
  error: { name: string; message: string } | null;
};

/**
 * Two transports, chosen by environment.
 *
 * SMTP wins when SMTP_HOST is set. It exists because Resend's shared sender
 * (`onboarding@resend.dev`) can only deliver to the address the Resend account
 * was registered with — fine for testing, useless for reminding a real vendor
 * contact — and verifying a domain needs DNS access that isn't always
 * available. Any mailbox that speaks SMTP gets round that: a Google Workspace
 * or Microsoft 365 account with an app password, or Brevo/SendGrid, all of
 * which will send to arbitrary recipients once you've authenticated as
 * somebody entitled to send.
 *
 * Both are instantiated lazily so importing this module during `next build`,
 * which has no runtime env, doesn't throw on missing credentials.
 */
function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

async function deliver(message: {
  to: string;
  cc?: string;
  subject: string;
  html: string;
}): Promise<SendResult> {
  if (smtpConfigured()) {
    try {
      const nodemailer = await import("nodemailer");
      const port = Number(process.env.SMTP_PORT ?? 587);
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        // 465 is implicit TLS; 587 upgrades with STARTTLS.
        secure: process.env.SMTP_SECURE
          ? process.env.SMTP_SECURE === "true"
          : port === 465,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
      const info = await transport.sendMail({ from: FROM, ...message });
      return { data: { id: info.messageId }, error: null };
    } catch (e) {
      const err = e as Error;
      return { data: null, error: { name: err.name, message: err.message } };
    }
  }

  const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: FROM,
    ...message,
  });
  return {
    data: result.data ? { id: result.data.id } : null,
    error: result.error
      ? { name: result.error.name, message: result.error.message }
      : null,
  };
}

/** Which transport is live, for diagnostics and the admin console. */
export function activeTransport() {
  return smtpConfigured()
    ? `SMTP (${process.env.SMTP_HOST})`
    : "Resend API";
}

/** A certificate as the emails need it — real rows and admin test samples both fit. */
export type MailableCert = Pick<
  CertDocument,
  | "cert_type"
  | "pic_name"
  | "expiry_date"
  | "marketing_email"
  | "management_email"
  | "reminder_days_before"
  | "second_reminder_days_before"
  | "escalation_days"
> & { folder?: { code: string; name: string } | null };

/** Options shared by every level. `to` overrides the stored recipient (admin tests). */
type SendOptions = { to?: string; test?: boolean };

/** The logo is served from this app's own /public, so it needs an absolute URL. */
function masthead() {
  return `<img src="${APP_URL}/benfoods-logo.png" alt="Ben Foods (S) Pte Ltd" width="200" height="46" style="display:block;border:0;height:auto;max-width:200px" />`;
}

function shell(
  title: string,
  accent: string,
  bodyHtml: string,
  test = false,
  notice = "",
) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:${C.page};padding:24px;color:${C.ink}">
    <div style="max-width:520px;margin:0 auto;background:${C.card};border:1px solid ${C.line};border-radius:12px;overflow:hidden">
      <div style="background:${accent};height:5px;font-size:0;line-height:0">&nbsp;</div>
      <div style="padding:24px">
        <div style="padding-bottom:16px;border-bottom:1px solid ${C.line}">${masthead()}</div>
        ${
          test
            ? `<p style="margin:16px 0 0;display:inline-block;background:${C.ink};color:#ffffff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.04em">TEST EMAIL — no action needed</p>`
            : ""
        }
        <div style="margin-top:16px">${notice}</div>
        <h1 style="margin:0 0 12px;font-size:18px;color:${C.ink}">${title}</h1>
        ${bodyHtml}
        <a href="${APP_URL}/dashboard" style="display:inline-block;margin-top:20px;background:${C.primary};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Open Cert Checker</a>
        <p style="margin-top:16px;font-size:12px;color:${C.muted}">
          Or paste this into your browser: <a href="${APP_URL}" style="color:${C.primary}">${APP_URL}</a>
        </p>
        <p style="margin-top:16px;font-size:12px;color:${C.muted}">Ben Foods · Cert Checker — automated reminder.</p>
      </div>
    </div>
  </div>`;
}

/** Vendor / PIC / expiry summary shared by both levels. */
function details(cert: MailableCert) {
  const rows: [string, string][] = [
    [
      "Vendor / Customer",
      cert.folder ? `${cert.folder.code} — ${cert.folder.name}` : "—",
    ],
    ["Certificate", cert.cert_type],
    ["PIC", cert.pic_name],
    ["Expiry", formatDate(cert.expiry_date)],
  ];
  return `<table style="margin:16px 0;border-collapse:collapse;font-size:14px">${rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:${C.muted}">${label}</td><td style="padding:4px 0;color:${C.ink};font-weight:600">${value}</td></tr>`,
    )
    .join("")}</table>`;
}

/** Which of the two advance reminders is being sent. */
export type ReminderStage = "first" | "second";

/**
 * Levels 1 and 2: the certificate is approaching its expiry date. Sent
 * `reminder_days_before` and then `second_reminder_days_before` days ahead so
 * there is time to arrange a renewal — these are the only two of the four that
 * arrive while the certificate is still valid.
 *
 * The two differ in tone rather than in content. The first opens the renewal;
 * the second says the same thing with less runway left, and says so, or a
 * second identical email reads as the system stuttering.
 */
export async function sendUpcomingExpiryEmail(
  cert: MailableCert,
  opts: SendOptions & { stage?: ReminderStage } = {},
) {
  const label = certLabel(cert);
  const days = daysUntil(cert.expiry_date);
  const when =
    days > 1 ? `in ${days} days` : days === 1 ? "tomorrow" : "today";

  const second = opts.stage === "second";
  const routed = route(opts.to || cert.marketing_email);

  // What happens next, from where this reminder sits in the sequence. The first
  // reminder points at the second — unless the second is switched off for this
  // certificate, in which case the expiry-day notice is what follows.
  const nextUp =
    !second && cert.second_reminder_days_before > 0
      ? `You will be reminded again <strong style="color:${C.ink}">${cert.second_reminder_days_before} day(s)</strong> before expiry, and again on the day.`
      : "You will be reminded again on the day it expires.";

  return deliver({
    to: routed.to,
    subject: `${opts.test ? "[TEST] " : ""}${routed.subjectPrefix}\u23f0 ${second ? "Reminder — expiring" : "Expiring"} ${when}: ${label}`,
    html: shell(
      second ? `Reminder: a certificate expires ${when}` : `A certificate expires ${when}`,
      C.brand,
      `<p style="margin:0;color:${C.muted}">${
        second
          ? "This is the second reminder for this certificate. It is still valid, but not for much longer."
          : "This certificate is still valid, but it is due for renewal."
      }</p>
       ${details(cert)}
       <p style="margin:0;color:${C.muted}">Please arrange the renewal and upload the new version before it expires. ${nextUp} Senior management is notified <strong style="color:${C.ink}">${cert.escalation_days} day(s)</strong> after expiry if it is still outstanding.</p>`,
      opts.test,
      routed.notice,
    ),
  });
}

/** Level 3: certificate has reached its expiry date. Notify the marketing contact. */
export async function sendExpiryEmail(cert: MailableCert, opts: SendOptions = {}) {
  const label = certLabel(cert);
  const routed = route(opts.to || cert.marketing_email);

  return deliver({
    to: routed.to,
    subject: `${opts.test ? "[TEST] " : ""}${routed.subjectPrefix}⚠️ Expired: ${label}`,
    html: shell(
      "A certificate has expired",
      C.orange,
      `<p style="margin:0;color:${C.muted}">The certificate below has reached its expiry date.</p>
       ${details(cert)}
       <p style="margin:0;color:${C.muted}">Please upload the renewed version. If it isn't updated within <strong style="color:${C.ink}">${cert.escalation_days} day(s)</strong>, senior management will be notified.</p>`,
      opts.test,
      routed.notice,
    ),
  });
}

/** Level 4: still not renewed after the grace period. Escalate to management. */
export async function sendEscalationEmail(
  cert: MailableCert,
  opts: SendOptions & { cc?: string | null } = {},
) {
  const label = certLabel(cert);
  const cc = opts.cc === undefined ? cert.marketing_email : opts.cc;
  const routed = route(opts.to || cert.management_email, cc);

  return deliver({
    ...(routed.cc ? { cc: routed.cc } : {}),
    to: routed.to,
    subject: `${opts.test ? "[TEST] " : ""}${routed.subjectPrefix}🚨 Escalation: ${label} still not renewed`,
    html: shell(
      "Escalation — overdue certificate",
      C.red,
      `<p style="margin:0;color:${C.muted}">The certificate below expired and has not been renewed after ${cert.escalation_days} day(s).</p>
       ${details(cert)}
       <p style="margin:0;color:${C.muted}">Marketing contact: <strong style="color:${C.ink}">${cert.marketing_email}</strong>. This has been escalated to senior management for action.</p>`,
      opts.test,
      routed.notice,
    ),
  });
}
