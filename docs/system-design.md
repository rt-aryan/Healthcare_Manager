# System Design Write-up

## 1. Double-booking prevention

Booking happens in two steps, both guarded at the database level, not just in
application code:

**Step 1 — Hold.** When a patient clicks a slot, the backend creates an
`Appointment` row with `status = HELD` and a `holdExpiresAt` timestamp
(`SLOT_HOLD_MINUTES`, default 5 minutes) inside a Prisma transaction. The
`Appointment` table has a **composite unique index on `(doctorId, slotStart)`**.
If two patients race for the same slot, the second `INSERT` hits the unique
constraint and fails with Postgres/SQLite error `P2002`, which the API maps to
`409 Slot no longer available`. This is the real defense — it works even under
concurrent requests hitting different app server instances, because the
guarantee lives in the database, not in in-memory locks.

Before inserting, the transaction also deletes any *expired* `HELD` rows for
that exact slot, so an abandoned hold doesn't permanently block the slot for
everyone else.

**Step 2 — Confirm.** The patient fills the symptom form and calls confirm,
which is itself wrapped in a transaction: it re-reads the appointment, checks
`status === HELD` and `holdExpiresAt > now()`, and only then flips it to
`BOOKED`. If the hold expired, confirm fails with `410 Gone` and the frontend
asks the patient to re-pick a slot. This prevents a patient from confirming a
booking minutes after their hold lapsed and silently double-booking a doctor
who was rebooked in the meantime.

Available-slot computation itself excludes any time that is `BOOKED`, or
`HELD` with a still-valid `holdExpiresAt`, so other patients never even see a
held slot as available.

## 2. Slot hold mechanism

The hold is deliberately short (default 5 min, configurable via
`SLOT_HOLD_MINUTES`) to balance two competing needs: patients need enough time
to type symptoms without racing a timer, but a slot shouldn't sit reserved
indefinitely if someone abandons the flow. Expired holds are lazily cleaned up
at the moment a new booking attempt touches that slot — no separate cron job
is required for correctness, though a periodic sweep could be added purely for
storage hygiene. Because holds are just `Appointment` rows with a different
`status`, no separate "reservation" table or cache (e.g. Redis) is needed; the
same unique index that prevents double-booking also prevents double-holding.

## 3. Doctor leave conflict handling

When an admin marks a doctor on leave for a date (`LeaveDay` upsert, unique on
`doctorId + date`), the API immediately queries all `BOOKED`/`HELD`
appointments for that doctor on that date, transitions them to `CANCELLED` in
a single `updateMany`, and returns the affected list to the caller. For each
affected appointment, a `LEAVE_CONFLICT` notification is written to the
`Notification` outbox addressed to the patient, explaining the cancellation
and asking them to rebook. Notification inserts happen after the cancellation update and are cheap and
idempotent to retry; a partially-applied leave day at worst causes the admin
to see 0 conflicts on first call and can safely re-run mark-leave, which
idempotently upserts.

Slot availability also checks `LeaveDay` directly (`getAvailableSlots` and
`holdSlot`), so once a doctor is on leave, no *new* holds/bookings can be
created for that date even before any cron job runs.

## 4. Slot generation & availability

Rather than pre-materializing every future slot as a row (which doesn't scale
and gets stale the moment working hours change), slots are computed on demand
from `WorkingHour` (recurring weekly ranges) minus taken/held times minus
leave days, for a single requested date. This keeps the source of truth small
(one row per weekday range per doctor) and avoids a background job that has to
regenerate months of slot rows whenever a doctor's hours change.

## 5. Notification failure handling

All outbound email (booking confirmation, reminders, cancellations, leave
conflicts, medication reminders) is written to a `Notification` outbox table
first (`status = PENDING`), never sent inline during the triggering request.
A cron job (`notification.job.js`) runs every minute, picks up due
`PENDING` rows, attempts delivery via Nodemailer, and on failure increments
`attempts` and reschedules `nextAttemptAt` with exponential backoff
(2, 4, 8, 16, 32 minutes). After 5 failed attempts the row is marked `FAILED`
and kept for admin inspection rather than silently dropped or retried
forever. This means a temporary SMTP outage never blocks a booking request
and never loses a notification.

## 6. LLM failure handling

Both LLM calls (pre-visit and post-visit) go through a single wrapper with a
20s timeout, up to 2 retries with backoff, and strict JSON parsing of the
response. On any failure — network error, timeout, malformed JSON — the
route catches it and persists a **fallback record** (`llmStatus = FAILED`,
raw symptoms/notes surfaced instead of an AI summary, urgency defaulted to
`MEDIUM` so it's flagged for manual triage rather than silently omitted) so
the booking/visit flow always completes successfully end-to-end.
