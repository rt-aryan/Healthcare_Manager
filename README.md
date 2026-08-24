# Healthcare Appointment & Follow-up Manager

A full-stack clinic platform with separate **Patient**, **Doctor**, and **Admin**
portals. Patients book appointments and submit symptoms in advance; an LLM
generates a pre-visit summary (urgency + chief complaint + suggested
questions) for the doctor; after the visit the doctor's clinical notes are
turned into a patient-friendly summary + medication schedule by the LLM; both
sides get email notifications and Google Calendar events for every booking,
reschedule, and cancellation.

- **Backend**: Node.js, Express, Prisma ORM, SQLite (swappable to Postgres)
- **Frontend**: React (Vite), React Router, Axios
- **LLM**: Anthropic Claude API
- **Email**: Nodemailer (SMTP — works with Mailgun, SendGrid SMTP relay, Gmail, etc.)
- **Calendar**: Google Calendar API via OAuth 2.0
- **Background jobs**: node-cron (notification retry queue, medication reminders)

See [`docs/system-design.md`](docs/system-design.md) for the design write-up
covering double-booking prevention, leave-conflict handling, the slot hold
mechanism, and notification failure handling.

---

## 1. Project structure

```
healthcare-appointment-manager/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma      # full DB schema (see section 5)
│   │   └── seed.js            # creates demo admin/doctor/patient accounts
│   ├── src/
│   │   ├── routes/            # auth, admin, patient, doctor, calendar
│   │   ├── services/          # booking, llm, email, calendar
│   │   ├── jobs/               # notification retry + medication reminder cron jobs
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
- (Optional, for production) a Postgres database
- An Anthropic API key — https://console.anthropic.com/
- SMTP credentials for email (Mailgun, SendGrid, or a Gmail app password)
- A Google Cloud project with the Calendar API enabled (see section 6)

---

## 3. Local setup — step by step

### 3.1 Clone / unzip and install dependencies

```bash
cd healthcare-appointment-manager

cd backend
npm install

cd ../frontend
npm install
```

### 3.2 Configure environment variables

**Backend** — copy the example and fill in real values:

```bash
cd backend
cp .env.example .env
```

Open `backend/.env` and set:

| Variable | Description |
|---|---|
| `PORT` | API port (default `4000`) |
| `FRONTEND_URL` | Your frontend origin, e.g. `http://localhost:5173` (used for CORS and OAuth redirect) |
| `DATABASE_URL` | `file:./dev.db` for local SQLite, or a Postgres connection string for production |
| `JWT_SECRET` | Any long random string |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `ANTHROPIC_MODEL` | e.g. `claude-sonnet-4-5` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Your email provider's SMTP credentials |
| `EMAIL_FROM` | The "from" address shown to recipients |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | From Google Cloud Console (section 6) |
| `SLOT_HOLD_MINUTES` | How long a slot stays reserved while a patient fills the symptom form (default `5`) |

**Frontend** — copy the example:

```bash
cd ../frontend
cp .env.example .env
```

Set `VITE_API_URL` to your backend's `/api` URL, e.g. `http://localhost:4000/api`.

### 3.3 Set up the database

```bash
cd ../backend
npx prisma generate
npx prisma migrate dev --name init
```

This creates `backend/prisma/dev.db` (SQLite) and applies the schema.

> If you switch `provider` in `schema.prisma` to `"postgresql"`, set
> `DATABASE_URL` to your Postgres connection string first, then run the same
> two commands.

### 3.4 Seed demo accounts (optional but recommended)

```bash
npm run seed
```

This creates:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@clinic.com` | `Password123!` |
| Doctor | `dr.smith@clinic.com` | `Password123!` |
| Patient | `patient@example.com` | `Password123!` |

### 3.5 Run the app

In one terminal:

```bash
cd backend
npm run dev
```

In another terminal:

```bash
cd frontend
npm run dev
```

Visit `http://localhost:5173`, log in with one of the seeded accounts (or
register a new patient), and explore.

---

## 4. API documentation

Base URL: `http://localhost:4000/api`. All protected routes require
`Authorization: Bearer <token>` (returned from login/register).

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | none | Register (defaults to PATIENT role) |
| POST | `/auth/login` | none | Log in, returns `{ token, user }` |

### Admin (role: ADMIN)
| Method | Path | Description |
|---|---|---|
| POST | `/admin/doctors` | Create a doctor account + profile + working hours |
| GET | `/admin/doctors` | List all doctors |
| PATCH | `/admin/doctors/:doctorId` | Update specialisation/slot duration/bio |
| PUT | `/admin/doctors/:doctorId/working-hours` | Replace weekly working hours |
| POST | `/admin/doctors/:doctorId/leave` | Mark a date as leave; auto-cancels conflicting bookings and notifies affected patients |
| GET | `/admin/appointments` | List all appointments (any status) |

### Patient (role: PATIENT)
| Method | Path | Description |
|---|---|---|
| GET | `/doctors/search?specialisation=` | Public: search doctors (no auth) |
| GET | `/patients/doctors/:doctorId/slots?date=YYYY-MM-DD` | Available slots for a date |
| POST | `/patients/appointments/hold` | Step 1: hold a slot `{ doctorId, slotStart, slotEnd }` |
| POST | `/patients/appointments/:id/confirm` | Step 2: submit symptoms, confirm booking, triggers LLM + emails + calendar |
| GET | `/patients/me/appointments` | My appointments (booked/completed/cancelled) |
| POST | `/patients/appointments/:id/cancel` | Cancel a booked appointment |

### Doctor (role: DOCTOR)
| Method | Path | Description |
|---|---|---|
| GET | `/doctors/me/appointments` | My upcoming/completed appointments with pre-visit AI summaries |
| POST | `/doctors/appointments/:id/visit-notes` | Submit clinical notes + prescriptions; triggers LLM patient summary + medication reminders |

### Google Calendar (any authenticated user)
| Method | Path | Description |
|---|---|---|
| GET | `/calendar/oauth/start` | Returns the Google consent URL to redirect the user to |
| GET | `/calendar/oauth/callback` | OAuth redirect target; stores tokens, redirects to frontend |

---

## 5. Database schema (summary)

Full definition: `backend/prisma/schema.prisma`.

- **User** — email/password/role (`PATIENT`/`DOCTOR`/`ADMIN`), 1:1 with `PatientProfile` or `DoctorProfile`, 1:1 with `GoogleToken`
- **DoctorProfile** — specialisation, slot duration, has many `WorkingHour` and `LeaveDay`
- **WorkingHour** — recurring weekly availability (`dayOfWeek`, `startTime`, `endTime`)
- **LeaveDay** — a specific date a doctor is unavailable (unique per doctor+date)
- **Appointment** — the booking itself; `status` is `HELD → BOOKED → COMPLETED/CANCELLED/NO_SHOW`; **unique on `(doctorId, slotStart)`** — this is what makes double-booking structurally impossible, not just checked in code
- **SymptomForm** — 1:1 with an appointment; raw symptoms + LLM urgency/chief complaint/suggested questions + LLM status/error for graceful failure handling
- **VisitNote** — 1:1 with an appointment; clinical notes + LLM patient-friendly summary/follow-up steps
- **Prescription** — medication, dosage, frequency, duration; has many `MedicationReminder`
- **MedicationReminder** — individual scheduled reminder times derived from prescription frequency
- **Notification** — the email **outbox**: every email (confirmation, reminder, cancellation, leave conflict, medication reminder) is written here first with `status = PENDING`, then delivered and retried by the background job

---

## 6. LLM prompts used

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

Both calls have a 20s timeout, up to 2 retries with backoff, and strict JSON
parsing. On any failure the route persists a fallback record instead of
breaking the request — see `docs/system-design.md` section 6.

---

## 7. Google Calendar setup (OAuth 2.0)

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create (or select) a project.
2. Enable the **Google Calendar API**: APIs & Services → Library → search "Google Calendar API" → Enable.
3. Configure the OAuth consent screen (APIs & Services → OAuth consent screen):
   - User type: External (or Internal if using Google Workspace)
   - Add your app name, support email
   - Add scope: `https://www.googleapis.com/auth/calendar.events`
   - Add test users (your own Google account) while the app is in "Testing" mode
4. Create OAuth credentials: APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:4000/api/calendar/oauth/callback` (must exactly match `GOOGLE_REDIRECT_URI` in `.env`; update this to your deployed backend URL in production)
5. Copy the generated **Client ID** and **Client Secret** into `backend/.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
6. In the app, a logged-in patient or doctor clicks **"Connect Google Calendar"** (shown on their portal), which calls `GET /api/calendar/oauth/start`, redirects to Google's consent screen, and on approval Google redirects back to `/api/calendar/oauth/callback`, which stores the access/refresh tokens against that user. From then on, every booking/cancellation for that user automatically creates/deletes a calendar event. If a user hasn't connected calendar, booking still works normally — calendar sync is best-effort and never blocks the flow.

---

## 8. Email provider setup

Any SMTP-compatible provider works. Two common options:

**Mailgun**: create an account, verify a sending domain (or use the sandbox
domain for testing), then use the SMTP credentials shown in Mailgun's
dashboard for `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`.

**Gmail (for quick local testing only)**: enable 2FA on the Gmail account,
generate an **App Password**, and use `smtp.gmail.com`, port `587`, your
Gmail address as `SMTP_USER`, and the app password as `SMTP_PASS`.

---

## 9. Deployment (free-tier friendly)

**Backend (Render, Railway, or Fly.io):**
1. Push this repo to GitHub (see section 10 below).
2. Create a new Web Service, point it at the `backend/` directory (set the root directory to `backend` if the platform asks).
3. Build command: `npm install && npx prisma generate && npx prisma migrate deploy`
4. Start command: `npm start`
5. Add all the environment variables from `backend/.env.example` in the platform's dashboard (use a managed Postgres add-on for `DATABASE_URL` in production instead of SQLite, since most of these platforms have an ephemeral filesystem).
6. Update `GOOGLE_REDIRECT_URI` to `https://<your-backend-domain>/api/calendar/oauth/callback` and add that same URL to the Google Cloud OAuth credentials.

**Frontend (Vercel or Netlify):**
1. Point the platform at the `frontend/` directory.
2. Build command: `npm run build`. Output directory: `dist`.
3. Set `VITE_API_URL` to `https://<your-backend-domain>/api`.
4. Update `FRONTEND_URL` in the backend's env vars to your deployed frontend URL (for CORS and the post-OAuth redirect).

---

## 10. Git setup and pushing to GitHub — every step

If this project isn't already a git repo (a fresh `.git` was initialized when
this was built), here's the full sequence from zero:

```bash
# 1. Go into the project folder
cd healthcare-appointment-manager

# 2. Initialize git (skip if already a repo — check with `git status`)
git init

# 3. Stage all files
git add .

# 4. Make the first commit
git commit -m "Initial commit: Healthcare Appointment & Follow-up Manager"

# 5. Rename the default branch to main (optional but common convention)
git branch -M main

# 6. Create a new EMPTY repository on GitHub (do this in the browser):
#    - Go to https://github.com/new
#    - Choose a repository name, e.g. "healthcare-appointment-manager"
#    - Do NOT initialize it with a README, .gitignore, or license
#      (this repo already has all three / their equivalents)
#    - Click "Create repository"

# 7. Link your local repo to the GitHub repo you just created
#    Replace YOUR_USERNAME and YOUR_REPO with your actual GitHub username/repo name
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git

# 8. Push your code
git push -u origin main
```

If GitHub asks for authentication:
- **HTTPS + Personal Access Token (recommended)**: when prompted for a
  password, paste a token generated at
  `https://github.com/settings/tokens` (classic token with `repo` scope, or a
  fine-grained token scoped to the new repo) — GitHub no longer accepts your
  account password directly.
- **SSH (alternative)**: generate a key with `ssh-keygen -t ed25519 -C "you@example.com"`,
  add the public key at `https://github.com/settings/keys`, then use
  `git remote add origin git@github.com:YOUR_USERNAME/YOUR_REPO.git` instead
  of the HTTPS URL in step 7.

### Making further changes later

```bash
git add .
git commit -m "Describe what changed"
git push
```

### Important: never commit real secrets

`backend/.env` and `frontend/.env` are excluded via `.gitignore` — only the
`.env.example` files (with placeholder values) are committed. Double-check
`git status` before your first push to confirm no real `.env` file, `dev.db`,
or API key is staged.

---

## 11. Known limitations / next steps

- SQLite is used by default for zero-config local setup; switch to Postgres
  (`schema.prisma` provider + `DATABASE_URL`) before any real production use,
  since SQLite doesn't handle concurrent writes at scale and most free
  hosting platforms wipe local files on redeploy.
- There is no automated test suite included; given the scope, prioritize
  adding integration tests around the hold/confirm booking race condition and
  the leave-conflict cancellation path first.
- Rate limiting and request throttling are not implemented on the API.
