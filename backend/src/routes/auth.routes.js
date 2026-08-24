const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../prismaClient");
const { hashPassword, comparePassword, signToken } = require("../utils/auth.util");

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  role: z.enum(["PATIENT", "DOCTOR", "ADMIN"]).default("PATIENT"),
  phone: z.string().optional(),
  // doctor-only optional fields, used when an admin pre-registers a doctor
  specialisation: z.string().optional(),
});

// Public self-registration is intended for PATIENTS. Doctor/Admin accounts
// are normally created by an existing admin via /api/admin/doctors, but this
// endpoint is left flexible for local dev/demo seeding.
router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password, name, role, phone, specialisation } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      phone,
      role,
      ...(role === "PATIENT" ? { patientProfile: { create: {} } } : {}),
      ...(role === "DOCTOR"
        ? { doctorProfile: { create: { specialisation: specialisation || "General" } } }
        : {}),
    },
  });

  const token = signToken(user);
  res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

router.post("/login", async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await comparePassword(parsed.data.password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const token = signToken(user);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

module.exports = router;
