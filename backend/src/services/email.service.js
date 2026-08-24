const nodemailer = require("nodemailer");
const prisma = require("../prismaClient");

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return transporter;
}

/**
 * Queue an email via the Notification outbox table instead of sending inline.
 * This is what makes notification delivery reliable: booking/cancellation logic
 * never has to wait on (or fail because of) an SMTP call, and the background
 * job in notification.job.js retries failed sends with backoff.
 */
async function queueNotification({ appointmentId, recipientEmail, type, subject, body }) {
  return prisma.notification.create({
    data: { appointmentId, recipientEmail, type, subject, body },
  });
}

/**
 * Attempt to actually send one notification row. Used by the retry job.
 * Never throws - always resolves to whether it succeeded, so the job loop
 * keeps going even if one email fails.
 */
async function sendNotification(notification) {
  try {
    await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || "no-reply@clinic.com",
      to: notification.recipientEmail,
      subject: notification.subject,
      html: notification.body,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { queueNotification, sendNotification };
