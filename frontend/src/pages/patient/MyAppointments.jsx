import { useEffect, useState } from "react";
import api from "../../api/client";

export default function MyAppointments() {
  const [appointments, setAppointments] = useState([]);

  async function load() {
    const { data } = await api.get("/patients/me/appointments");
    setAppointments(data);
  }
  useEffect(() => { load(); }, []);

  async function cancel(id) {
    if (!confirm("Cancel this appointment?")) return;
    await api.post(`/patients/appointments/${id}/cancel`);
    load();
  }

  return (
    <div>
      <h2>My appointments</h2>
      {appointments.length === 0 && <p className="muted">No appointments yet.</p>}
      {appointments.map((a) => (
        <div className="card" key={a.id}>
          <h3>Dr. {a.doctor.user.name} — {new Date(a.slotStart).toLocaleString()}</h3>
          <p>Status: <strong>{a.status}</strong></p>
          {a.symptomForm && (
            <p>Reported symptoms: {a.symptomForm.rawSymptoms}</p>
          )}
          {a.visitNote && (
            <div className="card" style={{ background: "#f5faf7" }}>
              <h4>Post-visit summary</h4>
              <p>{a.visitNote.llmPatientSummary}</p>
              <p><strong>Follow-up:</strong> {a.visitNote.llmFollowUpSteps}</p>
            </div>
          )}
          {a.prescriptions?.length > 0 && (
            <>
              <h4>Prescriptions</h4>
              <ul>
                {a.prescriptions.map((p) => (
                  <li key={p.id}>{p.medicationName} — {p.dosage}, {p.frequencyPerDay}x/day for {p.durationDays} days</li>
                ))}
              </ul>
            </>
          )}
          {a.status === "BOOKED" && (
            <button className="danger" onClick={() => cancel(a.id)}>Cancel appointment</button>
          )}
        </div>
      ))}
    </div>
  );
}
