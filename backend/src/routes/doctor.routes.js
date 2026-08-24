const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const { generatePostVisitSummary } = require("../services/llm.service");
const { queueNotification } = require("../services/email.service");

// Public: patients search doctors by specialisation (no auth required)
router.get("/search", async (req, res) => {
  const { specialisation } = req.query;
  const doctors = await prisma.doctorProfile.findMany({
    where: specialisation ? { specialisation: { contains: String(specialisation) } } : undefined,
    include: { user: { select: { name: true, email: true } }, workingHours: true },
  });
  res.json(doctors);
});

// Doctor: appointments assigned to me, with pre-visit LLM summary for prep
router.get("/me/appointments", requireAuth, requireRole("DOCTOR"), async (req, res) => {
  const doctorProfile = await prisma.doctorProfile.findUnique({ where: { userId: req.user.id } });
  if (!doctorProfile) return res.status(404).json({ error: "Doctor profile not found" });

  const appointments = await prisma.appointment.findMany({
    where: { doctorId: doctorProfile.id, status: { in: ["BOOKED", "COMPLETED"] } },
    include: {
      patient: { include: { user: { select: { name: true, email: true } } } },
      symptomForm: true,
      visitNote: true,
    },
    orderBy: { slotStart: "asc" },
  });
  res.json(appointments);
});

// Doctor: submit post-visit clinical notes + prescriptions -> triggers LLM
// patient-friendly summary generation and medication reminder scheduling.
router.post("/appointments/:appointmentId/visit-notes", requireAuth, requireRole("DOCTOR"), async (req, res) => {
  const schema = z.object({
    clinicalNotes: z.string().min(1),
    prescriptions: z
      .array(
        z.object({
          medicationName: z.string(),
          dosage: z.string(),
          frequencyPerDay: z.number().int().min(1).max(12),
          durationDays: z.number().int().min(1).max(90),
          instructions: z.string().optional(),
        })
      )
      .default([]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { clinicalNotes, prescriptions } = parsed.data;

  const appointment = await prisma.appointment.findUnique({
    where: { id: req.params.appointmentId },
    include: { doctor: true, patient: { include: { user: true } } },
  });
  if (!appointment) return res.status(404).json({ error: "Appointment not found" });

  const llmResult = await generatePostVisitSummary(clinicalNotes);

  const visitNote = await prisma.visitNote.create({
    data: {
      appointmentId: appointment.id,
      clinicalNotes,
      llmStatus: llmResult.ok ? "SUCCESS" : "FAILED",
      llmError: llmResult.ok ? null : llmResult.error,
      // Graceful degradation: if the LLM call failed, fall back to the raw
      // clinical notes so the patient still receives *something* useful.
      llmPatientSummary: llmResult.ok ? llmResult.data.summary : clinicalNotes,
      llmFollowUpSteps: llmResult.ok ? llmResult.data.followUpSteps : "Please contact the clinic for follow-up guidance.",
    },
  });

  for (const p of prescriptions) {
    const prescription = await prisma.prescription.create({
      data: { appointmentId: appointment.id, ...p },
    });

    // Schedule medication reminders spaced evenly through waking hours (8am-8pm)
    // for `durationDays`, `frequencyPerDay` times per day.
    const reminders = [];
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() + 1); // start reminders from tomorrow
    const windowStartHour = 8;
    const windowEndHour = 20;
    const intervalHours = (windowEndHour - windowStartHour) / p.frequencyPerDay;

    for (let day = 0; day < p.durationDays; day++) {
      for (let dose = 0; dose < p.frequencyPerDay; dose++) {
        const scheduledAt = new Date(startDate);
        scheduledAt.setDate(scheduledAt.getDate() + day);
        scheduledAt.setHours(windowStartHour + dose * intervalHours, 0, 0, 0);
        reminders.push({ prescriptionId: prescription.id, scheduledAt });
      }
    }
    if (reminders.length) await prisma.medicationReminder.createMany({ data: reminders });
  }

  await prisma.appointment.update({ where: { id: appointment.id }, data: { status: "COMPLETED" } });

  await queueNotification({
    appointmentId: appointment.id,
    recipientEmail: appointment.patient.user.email,
    type: "REMINDER",
    subject: "Your visit summary is ready",
    body: `<p>Hi ${appointment.patient.user.name},</p>
           <p>${visitNote.llmPatientSummary}</p>
           <p><strong>Follow-up:</strong> ${visitNote.llmFollowUpSteps}</p>`,
  });

  res.status(201).json({ visitNote });
});

module.exports = router;
