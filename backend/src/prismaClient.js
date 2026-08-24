const { PrismaClient } = require("@prisma/client");

// Single shared Prisma instance across the app (avoids exhausting DB connections)
const prisma = new PrismaClient();

module.exports = prisma;
