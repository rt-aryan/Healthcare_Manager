import { useEffect, useState } from "react";
import api from "../../api/client";
import CalendarConnect from "../../components/CalendarConnect";

export default function DoctorPortal() {
  const [appointments, setAppointments] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [notes, setNotes] = useState("");
  const [prescriptions, setPrescriptions] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const { data } = await api.get("/doctors/me/appointments");
    setAppointments(data);
  }
  useEffect(() => { load(); }, []);

  function openVisit(appt) {
    setOpenId(appt.id);
    setNotes("");
    setPrescriptions([{ medicationName: "", dosage: "", frequencyPerDay: 1, durationDays: 5, instructions: "" }]);
  }

  function updatePrescription(idx, field, value) {
    setPrescriptions((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  }

  function addPrescriptionRow() {
    setPrescriptions((prev) => [...prev, { medicationName: "", dosage: "", frequencyPerDay: 1, durationDays: 5, instructions: "" }]);
  }

  async function submitVisit(appointmentId) {
    setSubmitting(true);
    try {
      await api.post(`/doctors/appointments/${appointmentId}/visit-notes`, {
        clinicalNotes: notes,
        prescriptions: prescriptions.filter((p) => p.medicationName),
      });
      setOpenId(null);
      load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2>My appointments</h2>
      <CalendarConnect />
      {appointments.length === 0 && <p className="muted">No upcoming appointments.</p>}
      {appointments.map((a) => (
        <div className="card" key={a.id}>
          <h3>{a.patient.user.name} — {new Date(a.slotStart).toLocaleString()}</h3>
          <p>Status: <strong>{a.status}</strong></p>

          {a.symptomForm && (
            <div className="card" style={{ background: "#f5faf7" }}>
              <h4>
                AI pre-visit summary{" "}
                <span className={`badge ${a.symptomForm.llmUrgency?.toLowerCase()}`}>{a.symptomForm.llmUrgency}</span>
              </h4>
              <p><strong>Chief complaint:</strong> {a.symptomForm.llmChiefComplaint}</p>
              <p><strong>Raw symptoms:</strong> {a.symptomForm.rawSymptoms}</p>
              <p><strong>Suggested questions:</strong></p>
              <ul>
                {JSON.parse(a.symptomForm.llmSuggestedQuestions || "[]").map((q, i) => <li key={i}>{q}</li>)}
              </ul>
              {a.symptomForm.llmStatus === "FAILED" && (
                <p className="error-text">AI summary generation failed — please review symptoms manually.</p>
              )}
            </div>
          )}

          {a.status === "BOOKED" && openId !== a.id && (
            <button className="primary" onClick={() => openVisit(a)}>Add post-visit notes & prescription</button>
          )}

          {a.status === "COMPLETED" && a.visitNote && (
            <p className="muted">Visit notes already submitted.</p>
          )}

          {openId === a.id && (
            <div style={{ marginTop: 12 }}>
              <label>Clinical notes</label>
              <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />

              <h4>Prescriptions</h4>
              {prescriptions.map((p, idx) => (
                <div key={idx} className="card">
                  <label>Medication name</label>
                  <input value={p.medicationName} onChange={(e) => updatePrescription(idx, "medicationName", e.target.value)} />
                  <label>Dosage</label>
                  <input value={p.dosage} onChange={(e) => updatePrescription(idx, "dosage", e.target.value)} placeholder="e.g. 500mg" />
                  <label>Times per day</label>
                  <input type="number" min={1} max={12} value={p.frequencyPerDay} onChange={(e) => updatePrescription(idx, "frequencyPerDay", Number(e.target.value))} />
                  <label>Duration (days)</label>
                  <input type="number" min={1} max={90} value={p.durationDays} onChange={(e) => updatePrescription(idx, "durationDays", Number(e.target.value))} />
                  <label>Instructions</label>
                  <input value={p.instructions} onChange={(e) => updatePrescription(idx, "instructions", e.target.value)} placeholder="e.g. after meals" />
                </div>
              ))}
              <button className="secondary" onClick={addPrescriptionRow}>+ Add another medication</button>
              <br />
              <button className="primary" disabled={submitting} onClick={() => submitVisit(a.id)}>
                {submitting ? "Submitting..." : "Submit & generate patient summary"}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
