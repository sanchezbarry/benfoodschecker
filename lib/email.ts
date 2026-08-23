import { Resend } from "resend";
import type { CertDocument } from "@/lib/types";
import { certLabel, daysUntil, formatDate } from "@/lib/utils";
import { APP_URL } from "@/lib/constants";

const FROM = process.env.EMAIL_FROM ?? "Cert Checker <onboarding@resend.dev>";

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

// Instantiate lazily so importing this module during `next build` (which has
// no runtime env) doesn't throw on a missing API key.
function client() {
  return new Resend(process.env.RESEND_API_KEY);
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
  | "escalation_days"
> & { folder?: { code: string; name: string } | null };

/** Options shared by both levels. `to` overrides the stored recipient (admin tests). */
type SendOptions = { to?: string; test?: boolean };

/** The logo is served from this app's own /public, so it needs an absolute URL. */
function masthead() {
  return `<img src="${APP_URL}/benfoods-logo.png" alt="Ben Foods (S) Pte Ltd" width="200" height="46" style="display:block;border:0;height:auto;max-width:200px" />`;
}

function shell(title: string, accent: string, bodyHtml: string, test = false) {
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
        <h1 style="margin:16px 0 12px;font-size:18px;color:${C.ink}">${title}</h1>
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

/**
 * Level 0: the certificate is approaching its expiry date. Sent
 * `reminder_days_before` days ahead so there is time to arrange a renewal —
 * this is the only one of the three that arrives while the certificate is
 * still valid.
 */
export async function sendUpcomingExpiryEmail(
  cert: MailableCert,
  opts: SendOptions = {},
) {
  const label = certLabel(cert);
  const days = daysUntil(cert.expiry_date);
  const when =
    days > 1 ? `in ${days} days` : days === 1 ? "tomorrow" : "today";

  return client().emails.send({
    from: FROM,
    to: opts.to || cert.marketing_email,
    subject: `${opts.test ? "[TEST] " : ""}\u23f0 Expiring ${when}: ${label}`,
    html: shell(
      `A certificate expires ${when}`,
      C.brand,
      `<p style="margin:0;color:${C.muted}">This certificate is still valid, but it is due for renewal.</p>
       ${details(cert)}
       <p style="margin:0;color:${C.muted}">Please arrange the renewal and upload the new version before it expires. You will be reminded again on the day, and senior management is notified <strong style="color:${C.ink}">${cert.escalation_days} day(s)</strong> after that if it is still outstanding.</p>`,
      opts.test,
    ),
  });
}

/** Level 1: certificate has reached its expiry date. Notify the marketing contact. */
export async function sendExpiryEmail(cert: MailableCert, opts: SendOptions = {}) {
  const label = certLabel(cert);
  return client().emails.send({
    from: FROM,
    to: opts.to || cert.marketing_email,
    subject: `${opts.test ? "[TEST] " : ""}⚠️ Expired: ${label}`,
    html: shell(
      "A certificate has expired",
      C.orange,
      `<p style="margin:0;color:${C.muted}">The certificate below has reached its expiry date.</p>
       ${details(cert)}
       <p style="margin:0;color:${C.muted}">Please upload the renewed version. If it isn't updated within <strong style="color:${C.ink}">${cert.escalation_days} day(s)</strong>, senior management will be notified.</p>`,
      opts.test,
    ),
  });
}

/** Level 2: still not renewed after the grace period. Escalate to management. */
export async function sendEscalationEmail(
  cert: MailableCert,
  opts: SendOptions & { cc?: string | null } = {},
) {
  const label = certLabel(cert);
  const cc = opts.cc === undefined ? cert.marketing_email : opts.cc;
  return client().emails.send({
    from: FROM,
    to: opts.to || cert.management_email,
    ...(cc ? { cc } : {}),
    subject: `${opts.test ? "[TEST] " : ""}🚨 Escalation: ${label} still not renewed`,
    html: shell(
      "Escalation — overdue certificate",
      C.red,
      `<p style="margin:0;color:${C.muted}">The certificate below expired and has not been renewed after ${cert.escalation_days} day(s).</p>
       ${details(cert)}
       <p style="margin:0;color:${C.muted}">Marketing contact: <strong style="color:${C.ink}">${cert.marketing_email}</strong>. This has been escalated to senior management for action.</p>`,
      opts.test,
    ),
  });
}
