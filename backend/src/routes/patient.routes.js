const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const booking = require("../services/booking.service");
const { generatePreVisitSummary } = require("../services/llm.service");
const { queueNotification } = require("../services/email.service");
const { createEventForUser } = require("../services/calendar.service");

router.use(requireAuth, requireRole("PATIENT"));

async function getMyPatientProfile(userId) {
  return prisma.patientProfile.findUnique({ where: { userId } });
}

router.get("/doctors/:doctorId/slots", async (req, res) => {
  const { date } = req.query; // "YYYY-MM-DD"
  if (!date) return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
  try {
    const slots = await booking.getAvailableSlots(req.params.doctorId, String(date));
    res.json(slots);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Step 1: hold a slot (prevents double booking while patient fills symptom form)
router.post("/appointments/hold", async (req, res) => {
  const schema = z.object({ doctorId: z.string(), slotStart: z.string(), slotEnd: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const patient = await getMyPatientProfile(req.user.id);
  if (!patient) return res.status(404).json({ error: "Patient profile not found" });

  try {
    const appt = await booking.holdSlot({
      patientId: patient.id,
      doctorId: parsed.data.doctorId,
      slotStart: new Date(parsed.data.slotStart),
      slotEnd: new Date(parsed.data.slotEnd),
    });
    res.status(201).json({
      appointmentId: appt.id,
      holdExpiresAt: appt.holdExpiresAt,
      holdMinutes: booking.SLOT_HOLD_MINUTES,
    });
  } catch (err) {
    const status = err.code === "SLOT_TAKEN" ? 409 : err.code === "DOCTOR_ON_LEAVE" ? 409 : 400;
    res.status(status).json({ error: err.message, code: err.code });
  }
});

// Step 2: submit symptom form + confirm booking (HELD -> BOOKED)
router.post("/appointments/:appointmentId/confirm", async (req, res) => {
  const schema = z.object({ symptoms: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const patient = await getMyPatientProfile(req.user.id);
  if (!patient) return res.status(404).json({ error: "Patient profile not found" });

  let appt;
  try {
    appt = await booking.confirmBooking(req.params.appointmentId, patient.id);
  } catch (err) {
    const status = err.code === "HOLD_EXPIRED" ? 410 : err.code === "NOT_FOUND" ? 404 : 400;
    return res.status(status).json({ error: err.message, code: err.code });
  }

  const llmResult = await generatePreVisitSummary(parsed.data.symptoms);
  const symptomForm = await prisma.symptomForm.create({
    data: {
      appointmentId: appt.id,
      rawSymptoms: parsed.data.symptoms,
      llmStatus: llmResult.ok ? "SUCCESS" : "FAILED",
      llmError: llmResult.ok ? null : llmResult.error,
      // Graceful fallback: if the LLM fails, mark urgency unknown/Medium so the
      // doctor still sees the appointment flagged for manual triage rather than
      // silently missing information.
      llmUrgency: llmResult.ok ? llmResult.data.urgency.toUpperCase() : "MEDIUM",
      llmChiefComplaint: llmResult.ok ? llmResult.data.chiefComplaint : parsed.data.symptoms.slice(0, 200),
      llmSuggestedQuestions: llmResult.ok
        ? JSON.stringify(llmResult.data.suggestedQuestions)
        : JSON.stringify(["(AI summary unavailable — please review symptoms manually)"]),
    },
  });

  const full = await prisma.appointment.findUnique({
    where: { id: appt.id },
    include: {
      patient: { include: { user: true } },
      doctor: { include: { user: true } },
    },
  });

  // Queue booking confirmation emails for both sides (reliable via outbox + retry job)
  await queueNotification({
    appointmentId: appt.id,
    recipientEmail: full.patient.user.email,
    type: "BOOKING_CONFIRMATION",
    subject: "Appointment confirmed",
    body: `<p>Hi ${full.patient.user.name}, your appointment with Dr. ${full.doctor.user.name} on
           ${full.slotStart.toLocaleString()} is confirmed.</p>`,
  });
  await queueNotification({
    appointmentId: appt.id,
    recipientEmail: full.doctor.user.email,
    type: "BOOKING_CONFIRMATION",
    subject: "New appointment booked",
    body: `<p>Dr. ${full.doctor.user.name}, you have a new appointment with ${full.patient.user.name} on
           ${full.slotStart.toLocaleString()}. Urgency: ${symptomForm.llmUrgency}.</p>`,
  });

  // Best-effort Google Calendar sync for both patient and doctor (never blocks booking)
  const patientEventId = await createEventForUser(full.patient.user.id, {
    summary: `Appointment with Dr. ${full.doctor.user.name}`,
    description: `Chief complaint: ${symptomForm.llmChiefComplaint}`,
    start: full.slotStart,
    end: full.slotEnd,
  });
  const doctorEventId = await createEventForUser(full.doctor.user.id, {
    summary: `Appointment with ${full.patient.user.name}`,
    description: `Chief complaint: ${symptomForm.llmChiefComplaint}`,
    start: full.slotStart,
    end: full.slotEnd,
  });
  if (patientEventId || doctorEventId) {
    await prisma.appointment.update({
      where: { id: appt.id },
      data: { googleEventIdPatient: patientEventId, googleEventIdDoctor: doctorEventId },
    });
  }

  res.status(200).json({ appointment: full, symptomForm });
});

router.get("/me/appointments", async (req, res) => {
  const patient = await getMyPatientProfile(req.user.id);
  if (!patient) return res.status(404).json({ error: "Patient profile not found" });

  const appointments = await prisma.appointment.findMany({
    where: { patientId: patient.id, status: { not: "HELD" } },
    include: {
      doctor: { include: { user: { select: { name: true } } } },
      symptomForm: true,
      visitNote: true,
      prescriptions: true,
    },
    orderBy: { slotStart: "desc" },
  });
  res.json(appointments);
});

router.post("/appointments/:appointmentId/cancel", async (req, res) => {
  const patient = await getMyPatientProfile(req.user.id);
  const appt = await prisma.appointment.findUnique({
    where: { id: req.params.appointmentId },
    include: { doctor: { include: { user: true } }, patient: { include: { user: true } } },
  });
  if (!appt || appt.patientId !== patient.id) return res.status(404).json({ error: "Not found" });

  await booking.cancelAppointment(appt.id);

  await queueNotification({
    appointmentId: appt.id,
    recipientEmail: appt.doctor.user.email,
    type: "CANCELLATION",
    subject: "Appointment cancelled",
    body: `<p>${appt.patient.user.name} cancelled their appointment on ${appt.slotStart.toLocaleString()}.</p>`,
  });

  const { deleteEventForUser } = require("../services/calendar.service");
  if (appt.googleEventIdPatient) await deleteEventForUser(appt.patient.user.id, appt.googleEventIdPatient);
  if (appt.googleEventIdDoctor) await deleteEventForUser(appt.doctor.user.id, appt.googleEventIdDoctor);

  res.json({ ok: true });
});

module.exports = router;
