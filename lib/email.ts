import { Resend } from "resend";
import type { CertDocument } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const FROM = process.env.EMAIL_FROM ?? "Cert Checker <onboarding@resend.dev>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

// Instantiate lazily so importing this module during `next build` (which has
// no runtime env) doesn't throw on a missing API key.
function client() {
  return new Resend(process.env.RESEND_API_KEY);
}

function shell(title: string, accent: string, bodyHtml: string) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#0a0a0a;padding:24px;color:#ededed">
    <div style="max-width:520px;margin:0 auto;background:#171717;border:1px solid #262626;border-radius:12px;overflow:hidden">
      <div style="background:${accent};height:6px"></div>
      <div style="padding:24px">
        <h1 style="margin:0 0 12px;font-size:18px">${title}</h1>
        ${bodyHtml}
        ${
          APP_URL
            ? `<a href="${APP_URL}/dashboard" style="display:inline-block;margin-top:20px;background:#22c55e;color:#0a0a0a;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open Cert Checker</a>`
            : ""
        }
        <p style="margin-top:24px;font-size:12px;color:#888">Ben Foods · Cert Checker — automated reminder.</p>
      </div>
    </div>
  </div>`;
}

/** Level 1: certificate has reached its expiry date. Notify marketing. */
export async function sendExpiryEmail(doc: CertDocument) {
  return client().emails.send({
    from: FROM,
    to: doc.marketing_email,
    subject: `⚠️ Expired: ${doc.name}`,
    html: shell(
      "A certificate has expired",
      "#eab308",
      `<p style="margin:0;color:#d4d4d4">The document <strong>${doc.name}</strong> expired on <strong>${formatDate(
        doc.expiry_date,
      )}</strong>.</p>
       <p style="color:#d4d4d4">Please upload the renewed certificate. If it isn't updated within <strong>${doc.escalation_days} day(s)</strong>, senior management will be notified.</p>`,
    ),
  });
}

/** Level 2: still not renewed after the grace period. Escalate to management. */
export async function sendEscalationEmail(doc: CertDocument) {
  return client().emails.send({
    from: FROM,
    to: doc.management_email,
    cc: doc.marketing_email,
    subject: `🚨 Escalation: ${doc.name} still not renewed`,
    html: shell(
      "Escalation — overdue certificate",
      "#ef4444",
      `<p style="margin:0;color:#d4d4d4">The document <strong>${doc.name}</strong> expired on <strong>${formatDate(
        doc.expiry_date,
      )}</strong> and has not been renewed after ${doc.escalation_days} day(s).</p>
       <p style="color:#d4d4d4">Marketing contact: <strong>${doc.marketing_email}</strong>. This has been escalated to senior management for action.</p>`,
    ),
  });
}
