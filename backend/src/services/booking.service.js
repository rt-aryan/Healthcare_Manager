const prisma = require("../prismaClient");

const SLOT_HOLD_MINUTES = Number(process.env.SLOT_HOLD_MINUTES || 5);

/**
 * Compute available slots for a doctor on a given date, based on working
 * hours minus existing BOOKED/HELD (non-expired) appointments minus leave days.
 */
async function getAvailableSlots(doctorId, dateStr) {
  const doctor = await prisma.doctorProfile.findUnique({
    where: { id: doctorId },
    include: { workingHours: true, leaveDays: true },
  });
  if (!doctor) throw new Error("Doctor not found");

  const date = new Date(dateStr + "T00:00:00");
  const dayOfWeek = date.getDay();

  const onLeave = doctor.leaveDays.some(
    (l) => l.date.toISOString().slice(0, 10) === dateStr
  );
  if (onLeave) return [];

  const hours = doctor.workingHours.filter((w) => w.dayOfWeek === dayOfWeek);
  if (hours.length === 0) return [];

  // Existing appointments that occupy slots: BOOKED always, HELD only if not expired
  const dayStart = new Date(dateStr + "T00:00:00");
  const dayEnd = new Date(dateStr + "T23:59:59");
  const existing = await prisma.appointment.findMany({
    where: {
      doctorId,
      slotStart: { gte: dayStart, lte: dayEnd },
      OR: [
        { status: "BOOKED" },
        { status: "HELD", holdExpiresAt: { gt: new Date() } },
      ],
    },
    select: { slotStart: true },
  });
  const takenTimes = new Set(existing.map((e) => e.slotStart.toISOString()));

  const slots = [];
  for (const wh of hours) {
    let cursor = combineDateAndTime(date, wh.startTime);
    const end = combineDateAndTime(date, wh.endTime);
    while (cursor < end) {
      const slotEnd = new Date(cursor.getTime() + doctor.slotDurationMinutes * 60000);
      if (slotEnd <= end && !takenTimes.has(cursor.toISOString()) && cursor > new Date()) {
        slots.push({ start: new Date(cursor), end: slotEnd });
      }
      cursor = slotEnd;
    }
  }
  return slots;
}

function combineDateAndTime(date, timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Step 1 of booking: place a short-lived HOLD on a slot so the patient can
 * fill in the symptom form without another patient grabbing the same slot.
 * The unique(doctorId, slotStart) index means a second concurrent hold
 * attempt on the same slot will hit a DB constraint violation and fail fast -
 * this is the real double-booking defense, the transaction below is belt-and-braces.
 */
async function holdSlot({ patientId, doctorId, slotStart, slotEnd }) {
  // Reject if the doctor is on leave for that date
  const dateStr = slotStart.toISOString().slice(0, 10);
  const leave = await prisma.leaveDay.findFirst({
    where: { doctorId, date: { gte: new Date(dateStr + "T00:00:00"), lte: new Date(dateStr + "T23:59:59") } },
  });
  if (leave) {
    const err = new Error("Doctor is on leave for the selected date");
    err.code = "DOCTOR_ON_LEAVE";
    throw err;
  }

  const holdExpiresAt = new Date(Date.now() + SLOT_HOLD_MINUTES * 60000);

  return prisma.$transaction(async (tx) => {
    // Clean up any expired hold that might occupy this exact slot so the
    // unique constraint doesn't wrongly block a legitimate new hold.
    await tx.appointment.deleteMany({
      where: {
        doctorId,
        slotStart,
        status: "HELD",
        holdExpiresAt: { lt: new Date() },
      },
    });

    try {
      const appt = await tx.appointment.create({
        data: {
          patientId,
          doctorId,
          slotStart,
          slotEnd,
          status: "HELD",
          holdExpiresAt,
        },
      });
      return appt;
    } catch (err) {
      // Unique constraint violation => someone else holds/booked this slot already
      if (err.code === "P2002") {
        const conflictErr = new Error("This slot is no longer available");
        conflictErr.code = "SLOT_TAKEN";
        throw conflictErr;
      }
      throw err;
    }
  });
}

/**
 * Step 2 of booking: confirm a held appointment (after symptom form is
 * submitted), converting HELD -> BOOKED. Fails if the hold expired.
 */
async function confirmBooking(appointmentId, patientId) {
  return prisma.$transaction(async (tx) => {
    const appt = await tx.appointment.findUnique({ where: { id: appointmentId } });
    if (!appt || appt.patientId !== patientId) {
      const e = new Error("Appointment not found");
      e.code = "NOT_FOUND";
      throw e;
    }
    if (appt.status !== "HELD") {
      const e = new Error("Appointment is not in a holdable state");
      e.code = "INVALID_STATE";
      throw e;
    }
    if (appt.holdExpiresAt && appt.holdExpiresAt < new Date()) {
      const e = new Error("Slot hold expired, please rebook");
      e.code = "HOLD_EXPIRED";
      throw e;
    }
    return tx.appointment.update({
      where: { id: appointmentId },
      data: { status: "BOOKED", holdExpiresAt: null },
    });
  });
}

async function cancelAppointment(appointmentId) {
  return prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: "CANCELLED" },
  });
}

/**
 * When admin marks a doctor on leave for a date that already has BOOKED
 * appointments, those appointments must be cancelled and patients notified.
 * Returns the list of affected appointments so the route can queue emails.
 */
async function handleLeaveConflicts(doctorId, dateStr) {
  const dayStart = new Date(dateStr + "T00:00:00");
  const dayEnd = new Date(dateStr + "T23:59:59");

  const affected = await prisma.appointment.findMany({
    where: {
      doctorId,
      slotStart: { gte: dayStart, lte: dayEnd },
      status: { in: ["BOOKED", "HELD"] },
    },
    include: {
      patient: { include: { user: true } },
      doctor: { include: { user: true } },
    },
  });

  await prisma.appointment.updateMany({
    where: { id: { in: affected.map((a) => a.id) } },
    data: { status: "CANCELLED" },
  });

  return affected;
}

module.exports = {
  getAvailableSlots,
  holdSlot,
  confirmBooking,
  cancelAppointment,
  handleLeaveConflicts,
  SLOT_HOLD_MINUTES,
};
