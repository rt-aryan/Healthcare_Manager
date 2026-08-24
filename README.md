# Healthcare Appointment & Follow-up Manager

A full-stack clinic appointment platform with separate **Patient**, **Doctor**,
and **Admin** portals. Patients book appointments and submit symptoms in
advance; an AI model generates a pre-visit summary (urgency level, chief
complaint, and suggested questions) for the doctor; after the visit, the
doctor's clinical notes are converted into a patient-friendly summary and
medication schedule. Both parties receive email notifications and Google
Calendar events for every booking, reschedule, and cancellation.

## Technology Stack

- **Backend**: Node.js, Express, Prisma ORM, SQLite (configurable for PostgreSQL)
- **Frontend**: React (Vite), React Router, Axios
- **AI Integration**: Anthropic Claude API
- **Email**: Nodemailer (SMTP-compatible — Mailgun, SendGrid, Gmail, etc.)
- **Calendar**: Google Calendar API via OAuth 2.0
- **Background Processing**: node-cron (notification retry queue, medication reminders)

Refer to [`docs/system-design.md`](docs/system-design.md) for the system
design write-up covering double-booking prevention, leave-conflict handling,
the slot hold mechanism, and notification reliability.

---

## 1. Project Structure

```
healthcare-appointment-manager/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma      # database schema (see section 5)
│   │   └── seed.js            # demo admin/doctor/patient accounts
│   ├── src/
│   │   ├── routes/            # auth, admin, patient, doctor, calendar
│   │   ├── services/          # booking, LLM, email, calendar
│   │   ├── jobs/               # notification retry + medication reminder jobs
│   │   ├── middleware/         # auth, error handling
│   │   └── server.js
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/patient|doctor|admin/
│   │   ├── components/
│   │   ├── context/AuthContext.jsx
│   │   └── api/client.js
│   ├── .env.example
│   └── package.json
├── docs/
│   └── system-design.md
└── README.md
```

---

## 2. Prerequisites

- Node.js 18+ and npm
- PostgreSQL database (recommended for production; SQLite is used by default for local development)
- An Anthropic API key — https://console.anthropic.com/
- SMTP credentials for email delivery (Mailgun, SendGrid, or equivalent)
- A Google Cloud project with the Calendar API enabled (see section 6)

---

## 3. Setup Instructions

### 3.1 Install Dependencies

```bash
cd healthcare-appointment-manager

cd backend
npm install

cd ../frontend
npm install
```

### 3.2 Configure Environment Variables

**Backend**

```bash
cd backend
cp .env.example .env
```

Set the following values in `backend/.env`:

| Variable | Description |
|---|---|
| `PORT` | API port (default `4000`) |
| `FRONTEND_URL` | Frontend origin, e.g. `http://localhost:5173` (used for CORS and OAuth redirect) |
| `DATABASE_URL` | `file:./dev.db` for local SQLite, or a PostgreSQL connection string for production |
| `JWT_SECRET` | A long, random secret string |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ANTHROPIC_MODEL` | e.g. `claude-sonnet-4-5` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Email provider SMTP credentials |
| `EMAIL_FROM` | Sender address shown to recipients |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Google Cloud OAuth credentials (section 6) |
| `SLOT_HOLD_MINUTES` | Duration a slot remains reserved while a patient completes the symptom form (default `5`) |

**Frontend**

```bash
cd ../frontend
cp .env.example .env
```

Set `VITE_API_URL` to the backend API URL, e.g. `http://localhost:4000/api`.

### 3.3 Initialize the Database

```bash
cd ../backend
npx prisma generate
npx prisma migrate dev --name init
```

This applies the schema and creates the local database. To use PostgreSQL,
update the `provider` in `schema.prisma` to `"postgresql"` and set
`DATABASE_URL` to the PostgreSQL connection string before running the
commands above.

### 3.4 Seed Demo Accounts

```bash
npm run seed
```

This creates the following accounts:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@clinic.com` | `Password123!` |
| Doctor | `dr.smith@clinic.com` | `Password123!` |
| Patient | `patient@example.com` | `Password123!` |

### 3.5 Run the Application

```bash
# Terminal 1
cd backend
npm run dev

# Terminal 2
cd frontend
npm run dev
```

Open `http://localhost:5173` and log in with one of the accounts above, or
register a new patient account.

---

## 4. API Documentation

Base URL: `http://localhost:4000/api`. All protected routes require the
header `Authorization: Bearer <token>`, returned from login/registration.

### Authentication
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | none | Register a new account (defaults to PATIENT role) |
| POST | `/auth/login` | none | Authenticate and receive `{ token, user }` |

### Admin (role: ADMIN)
| Method | Path | Description |
|---|---|---|
| POST | `/admin/doctors` | Create a doctor account, profile, and working hours |
| GET | `/admin/doctors` | List all doctors |
| PATCH | `/admin/doctors/:doctorId` | Update specialisation, slot duration, or bio |
| PUT | `/admin/doctors/:doctorId/working-hours` | Replace weekly working hours |
| POST | `/admin/doctors/:doctorId/leave` | Mark a date as leave; cancels conflicting bookings and notifies affected patients |
| GET | `/admin/appointments` | List all appointments |

### Patient (role: PATIENT)
| Method | Path | Description |
|---|---|---|
| GET | `/doctors/search?specialisation=` | Search doctors by specialisation (public) |
| GET | `/patients/doctors/:doctorId/slots?date=YYYY-MM-DD` | Retrieve available slots for a date |
| POST | `/patients/appointments/hold` | Reserve a slot: `{ doctorId, slotStart, slotEnd }` |
| POST | `/patients/appointments/:id/confirm` | Submit symptoms and confirm the booking |
| GET | `/patients/me/appointments` | List the authenticated patient's appointments |
| POST | `/patients/appointments/:id/cancel` | Cancel a booked appointment |

### Doctor (role: DOCTOR)
| Method | Path | Description |
|---|---|---|
| GET | `/doctors/me/appointments` | List the doctor's appointments with pre-visit AI summaries |
| POST | `/doctors/appointments/:id/visit-notes` | Submit clinical notes and prescriptions; generates the patient-facing summary and schedules medication reminders |

### Google Calendar (any authenticated user)
| Method | Path | Description |
|---|---|---|
| GET | `/calendar/oauth/start` | Returns the Google OAuth consent URL |
| GET | `/calendar/oauth/callback` | OAuth redirect endpoint; stores tokens and redirects to the frontend |

---

## 5. Database Schema

Full definition: `backend/prisma/schema.prisma`.

- **User** — email, password hash, role (`PATIENT` / `DOCTOR` / `ADMIN`); related 1:1 to `PatientProfile` or `DoctorProfile`, and 1:1 to `GoogleToken`
- **DoctorProfile** — specialisation, slot duration; related to `WorkingHour` and `LeaveDay`
- **WorkingHour** — recurring weekly availability (`dayOfWeek`, `startTime`, `endTime`)
- **LeaveDay** — a specific date on which a doctor is unavailable (unique per doctor and date)
- **Appointment** — the core booking record; `status` transitions through `HELD → BOOKED → COMPLETED / CANCELLED / NO_SHOW`; enforces a unique constraint on `(doctorId, slotStart)` to guarantee slot integrity at the database level
- **SymptomForm** — related 1:1 to an appointment; stores raw symptoms and the AI-generated urgency, chief complaint, and suggested questions
- **VisitNote** — related 1:1 to an appointment; stores clinical notes and the AI-generated patient summary and follow-up steps
- **Prescription** — medication, dosage, frequency, and duration; related to `MedicationReminder`
- **MedicationReminder** — individual scheduled reminder times derived from prescription frequency
- **Notification** — outbound email queue; every notification (booking confirmation, reminder, cancellation, leave conflict, medication reminder) is recorded here with delivery status and retried by the background job on failure

---

## 6. AI (LLM) Integration

**Pre-visit summary** (`src/services/llm.service.js` → `generatePreVisitSummary`):
```
Analyse these symptoms and return ONLY valid JSON (no markdown, no prose) in this exact shape:
{"urgency": "Low" | "Medium" | "High", "chiefComplaint": string, "suggestedQuestions": [string, string, string]}

Symptoms: <symptoms>
```

**Post-visit summary** (`generatePostVisitSummary`):
```
Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps.
Return ONLY valid JSON (no markdown, no prose) in this exact shape:
{"summary": string, "medicationSchedule": string, "followUpSteps": string}

Clinical notes: <notes>
```

Both calls apply a request timeout, automatic retries with backoff, and
strict response validation. On failure, the system persists a fallback
record so the booking and visit workflows always complete successfully. See
`docs/system-design.md`, section 6, for details.

---

## 7. Google Calendar Setup (OAuth 2.0)

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Enable the **Google Calendar API**: APIs & Services → Library → search "Google Calendar API" → Enable.
3. Configure the OAuth consent screen (APIs & Services → OAuth consent screen):
   - User type: External (or Internal for Google Workspace)
   - Provide the application name and support email
   - Add scope: `https://www.googleapis.com/auth/calendar.events`
   - Add authorized test users while the application is in Testing mode
4. Create OAuth credentials: APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Authorized redirect URI: matches `GOOGLE_REDIRECT_URI` in `.env`, e.g. `http://localhost:4000/api/calendar/oauth/callback` (update to the production backend URL when deployed)
5. Copy the generated **Client ID** and **Client Secret** into `backend/.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
6. From their respective portal, a patient or doctor selects **Connect Google Calendar**, which initiates the OAuth flow via `GET /api/calendar/oauth/start`. On approval, Google redirects to `/api/calendar/oauth/callback`, which stores the access and refresh tokens for that user. Subsequent bookings and cancellations automatically create, update, or remove the corresponding calendar event. Calendar synchronization is independent of the booking flow and does not affect appointment scheduling if not connected.

---

## 8. Email Provider Setup

Any SMTP-compatible provider is supported.

**Mailgun**: create an account, verify a sending domain, and use the SMTP
credentials from the Mailgun dashboard for `SMTP_HOST`, `SMTP_USER`, and
`SMTP_PASS`.

**Gmail**: enable two-factor authentication on the account, generate an App
Password, and use `smtp.gmail.com`, port `587`, the Gmail address as
`SMTP_USER`, and the App Password as `SMTP_PASS`.

---

## 9. Deployment

**Backend (Render, Railway, or similar):**
1. Deploy the `backend/` directory as the service root.
2. Build command: `npm install && npx prisma generate && npx prisma migrate deploy`
3. Start command: `npm start`
4. Configure all environment variables listed in `backend/.env.example`. Use a managed PostgreSQL instance for `DATABASE_URL` in production.
5. Set `GOOGLE_REDIRECT_URI` to the deployed backend's callback URL and register the same URL in the Google Cloud OAuth credentials.

**Frontend (Vercel, Netlify, or similar):**
1. Deploy the `frontend/` directory as the project root.
2. Build command: `npm run build`. Output directory: `dist`.
3. Set `VITE_API_URL` to the deployed backend's API URL.
4. Update `FRONTEND_URL` in the backend environment configuration to the deployed frontend URL.

---

## 10. Security Notes

- `backend/.env` and `frontend/.env` are excluded from version control via `.gitignore`; only `.env.example` files with placeholder values are tracked.
- Passwords are hashed with bcrypt before storage.
- All role-restricted API routes are protected by JWT-based authentication and role authorization middleware.
- Google Calendar tokens are stored per-user and refreshed automatically by the OAuth client.
