const cron = require("node-cron");
const prisma = require("../prismaClient");
const { sendNotification } = require("../services/email.service");

const MAX_ATTEMPTS = 5;

/**
 * Notification delivery reliability strategy:
 * 1. Emails are never sent inline during a request - they're written to the
 *    Notification outbox table first (see email.service.queueNotification).
 * 2. This job runs every minute, picks up PENDING rows whose nextAttemptAt
 *    has passed, and tries to send them.
 * 3. On failure, attempts is incremented and nextAttemptAt is pushed out with
 *    exponential backoff (1m, 2m, 4m, 8m, 16m). After MAX_ATTEMPTS the row is
 *    marked FAILED and left in the DB for manual/admin inspection instead of
 *    being silently dropped.
 */
async function processNotificationQueue() {
  const due = await prisma.notification.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
    take: 50,
  });

  for (const notification of due) {
    const result = await sendNotification(notification);

    if (result.ok) {
      await prisma.notification.update({
        where: { id: notification.id },
        data: { status: "SENT" },
      });
    } else {
      const attempts = notification.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      const backoffMinutes = Math.pow(2, attempts); // 2, 4, 8, 16, 32
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          attempts,
          lastError: result.error,
          status: exhausted ? "FAILED" : "PENDING",
          nextAttemptAt: new Date(Date.now() + backoffMinutes * 60000),
        },
      });
    }
  }
}

function startNotificationJob() {
  cron.schedule("* * * * *", () => {
    processNotificationQueue().catch((err) => console.error("[notification.job] error:", err));
  });
  console.log("[notification.job] scheduled (every minute)");
}

module.exports = { startNotificationJob, processNotificationQueue };
