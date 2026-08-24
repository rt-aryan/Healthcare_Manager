require("dotenv").config();
require("express-async-errors");

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const patientRoutes = require("./routes/patient.routes");
const doctorRoutes = require("./routes/doctor.routes");
const calendarRoutes = require("./routes/calendar.routes");
const errorHandler = require("./middleware/error.middleware");
const { startNotificationJob } = require("./jobs/notification.job");
const { startMedicationReminderJob } = require("./jobs/medication-reminder.job");

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/patients", patientRoutes);
app.use("/api/doctors", doctorRoutes);
app.use("/api/calendar", calendarRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Healthcare Appointment Manager API listening on port ${PORT}`);
  startNotificationJob();
  startMedicationReminderJob();
});

module.exports = app;
