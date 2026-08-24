const cron = require("node-cron");
const prisma = require("../prismaClient");
const { queueNotification } = require("../services/email.service");

/**
 * Runs every 15 minutes: finds MedicationReminder rows whose scheduledAt has
 * passed and haven't been sent, and queues an email notification for each
 * (actual sending/retries are handled by notification.job.js's outbox worker).
 */
async function processDueReminders() {
  const due = await prisma.medicationReminder.findMany({
    where: { sent: false, scheduledAt: { lte: new Date() } },
    include: {
      prescription: {
        include: {
          appointment: {
            include: { patient: { include: { user: true } }, doctor: { include: { user: true } } },
          },
        },
      },
    },
    take: 100,
  });

  for (const reminder of due) {
    const { prescription } = reminder;
    const { patient, doctor } = prescription.appointment;

    await queueNotification({
      appointmentId: prescription.appointmentId,
      recipientEmail: patient.user.email,
      type: "MEDICATION_REMINDER",
      subject: `Medication reminder: ${prescription.medicationName}`,
      body: `<p>Hi ${patient.user.name}, this is a reminder to take your medication:</p>
             <p><strong>${prescription.medicationName}</strong> - ${prescription.dosage}<br/>
             ${prescription.instructions || ""}</p>
             <p>Prescribed by Dr. ${doctor.user.name}</p>`,
    });

    await prisma.medicationReminder.update({
      where: { id: reminder.id },
      data: { sent: true, sentAt: new Date() },
    });
  }
}

function startMedicationReminderJob() {
  cron.schedule("*/15 * * * *", () => {
    processDueReminders().catch((err) => console.error("[medication-reminder.job] error:", err));
  });
  console.log("[medication-reminder.job] scheduled (every 15 min)");
}

module.exports = { startMedicationReminderJob, processDueReminders };
