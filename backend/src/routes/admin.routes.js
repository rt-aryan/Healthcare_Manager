const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const { hashPassword } = require("../utils/auth.util");
const { handleLeaveConflicts } = require("../services/booking.service");
const { queueNotification } = require("../services/email.service");

router.use(requireAuth, requireRole("ADMIN"));

// Create a doctor profile (creates the User + DoctorProfile together)
router.post("/doctors", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string(),
    specialisation: z.string(),
    slotDurationMinutes: z.number().int().positive().default(30),
    bio: z.string().optional(),
    workingHours: z
      .array(z.object({ dayOfWeek: z.number().min(0).max(6), startTime: z.string(), endTime: z.string() }))
      .optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: d.email } });
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await hashPassword(d.password);
  const user = await prisma.user.create({
    data: {
      email: d.email,
      passwordHash,
      name: d.name,
      role: "DOCTOR",
      doctorProfile: {
        create: {
          specialisation: d.specialisation,
          slotDurationMinutes: d.slotDurationMinutes,
          bio: d.bio,
          workingHours: d.workingHours ? { create: d.workingHours } : undefined,
        },
      },
    },
    include: { doctorProfile: { include: { workingHours: true } } },
  });

  res.status(201).json({ id: user.id, doctorProfileId: user.doctorProfile.id });
});

router.get("/doctors", async (req, res) => {
  const doctors = await prisma.doctorProfile.findMany({
    include: { user: { select: { name: true, email: true } }, workingHours: true, leaveDays: true },
  });
  res.json(doctors);
});

router.patch("/doctors/:doctorId", async (req, res) => {
  const schema = z.object({
    specialisation: z.string().optional(),
    slotDurationMinutes: z.number().int().positive().optional(),
    bio: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const doctor = await prisma.doctorProfile.update({
    where: { id: req.params.doctorId },
    data: parsed.data,
  });
  res.json(doctor);
});

router.put("/doctors/:doctorId/working-hours", async (req, res) => {
  const schema = z.array(
    z.object({ dayOfWeek: z.number().min(0).max(6), startTime: z.string(), endTime: z.string() })
  );
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const doctorId = req.params.doctorId;
  await prisma.$transaction([
    prisma.workingHour.deleteMany({ where: { doctorId } }),
    prisma.workingHour.createMany({ data: parsed.data.map((wh) => ({ ...wh, doctorId })) }),
  ]);
  res.json({ ok: true });
});

/**
 * Mark a doctor on leave for a date. Any existing BOOKED/HELD appointments
 * on that date are cancelled and affected patients are queued a
 * LEAVE_CONFLICT notification email (see booking.service.handleLeaveConflicts
 * and notification.job.js for the retryable delivery).
 */
router.post("/doctors/:doctorId/leave", async (req, res) => {
  const schema = z.object({ date: z.string(), reason: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const doctorId = req.params.doctorId;
  const { date, reason } = parsed.data;

  const leaveDay = await prisma.leaveDay.upsert({
    where: { doctorId_date: { doctorId, date: new Date(date + "T00:00:00") } },
    create: { doctorId, date: new Date(date + "T00:00:00"), reason },
    update: { reason },
  });

  const affected = await handleLeaveConflicts(doctorId, date);

  for (const appt of affected) {
    await queueNotification({
      appointmentId: appt.id,
      recipientEmail: appt.patient.user.email,
      type: "LEAVE_CONFLICT",
      subject: "Your appointment has been cancelled - doctor unavailable",
      body: `<p>Hi ${appt.patient.user.name},</p>
             <p>Unfortunately Dr. ${appt.doctor.user.name} is unavailable on ${date} and your appointment
             scheduled for ${appt.slotStart.toLocaleString()} has been cancelled. Please rebook a new slot.
             We're sorry for the inconvenience.</p>`,
    });
  }

  res.status(201).json({ leaveDay, affectedAppointments: affected.length });
});

router.get("/appointments", async (req, res) => {
  const appointments = await prisma.appointment.findMany({
    include: {
      patient: { include: { user: { select: { name: true, email: true } } } },
      doctor: { include: { user: { select: { name: true, email: true } } } },
    },
    orderBy: { slotStart: "desc" },
  });
  res.json(appointments);
});

module.exports = router;
