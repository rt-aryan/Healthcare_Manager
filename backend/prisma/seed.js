require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("Password123!", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@clinic.com" },
    update: {},
    create: { email: "admin@clinic.com", passwordHash, name: "Clinic Admin", role: "ADMIN" },
  });

  const doctorUser = await prisma.user.upsert({
    where: { email: "dr.smith@clinic.com" },
    update: {},
    create: {
      email: "dr.smith@clinic.com",
      passwordHash,
      name: "Dr. Jane Smith",
      role: "DOCTOR",
      doctorProfile: {
        create: {
          specialisation: "General Medicine",
          slotDurationMinutes: 30,
          bio: "General physician with 10 years of experience.",
          workingHours: {
            create: [
              { dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
              { dayOfWeek: 2, startTime: "09:00", endTime: "17:00" },
              { dayOfWeek: 3, startTime: "09:00", endTime: "17:00" },
              { dayOfWeek: 4, startTime: "09:00", endTime: "17:00" },
              { dayOfWeek: 5, startTime: "09:00", endTime: "13:00" },
            ],
          },
        },
      },
    },
  });

  const patientUser = await prisma.user.upsert({
    where: { email: "patient@example.com" },
    update: {},
    create: {
      email: "patient@example.com",
      passwordHash,
      name: "Alex Patient",
      role: "PATIENT",
      patientProfile: { create: {} },
    },
  });

  console.log("Seed complete:");
  console.log("  Admin:   admin@clinic.com / Password123!");
  console.log("  Doctor:  dr.smith@clinic.com / Password123!");
  console.log("  Patient: patient@example.com / Password123!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
