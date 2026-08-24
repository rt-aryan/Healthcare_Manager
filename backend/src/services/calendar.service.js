const { google } = require("googleapis");
const prisma = require("../prismaClient");

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl(state) {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
    state, // carries the userId so the callback knows who authorized
  });
}

async function exchangeCodeForTokens(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

async function saveTokensForUser(userId, tokens) {
  return prisma.googleToken.upsert({
    where: { userId },
    create: {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      scope: tokens.scope,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
    update: {
      accessToken: tokens.access_token,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      scope: tokens.scope,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
  });
}

async function getClientForUser(userId) {
  const record = await prisma.googleToken.findUnique({ where: { userId } });
  if (!record) return null;

  const client = getOAuthClient();
  client.setCredentials({
    access_token: record.accessToken,
    refresh_token: record.refreshToken,
  });

  // googleapis auto-refreshes; persist new access token when it rotates
  client.on("tokens", async (tokens) => {
    await saveTokensForUser(userId, { ...tokens, refresh_token: tokens.refresh_token || record.refreshToken });
  });

  return client;
}

/**
 * Create a calendar event for a user, if they've connected Google Calendar.
 * Returns null (never throws) if the user hasn't connected calendar, or if
 * the API call fails - calendar sync is a nice-to-have, not a booking blocker.
 */
async function createEventForUser(userId, { summary, description, start, end, attendees = [] }) {
  try {
    const client = await getClientForUser(userId);
    if (!client) return null;

    const calendar = google.calendar({ version: "v3", auth: client });
    const res = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary,
        description,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        attendees,
      },
    });
    return res.data.id;
  } catch (err) {
    console.error("[calendar] createEvent failed:", err.message);
    return null;
  }
}

async function updateEventForUser(userId, eventId, patch) {
  try {
    if (!eventId) return null;
    const client = await getClientForUser(userId);
    if (!client) return null;

    const calendar = google.calendar({ version: "v3", auth: client });
    await calendar.events.patch({ calendarId: "primary", eventId, requestBody: patch });
    return true;
  } catch (err) {
    console.error("[calendar] updateEvent failed:", err.message);
    return false;
  }
}

async function deleteEventForUser(userId, eventId) {
  try {
    if (!eventId) return null;
    const client = await getClientForUser(userId);
    if (!client) return null;

    const calendar = google.calendar({ version: "v3", auth: client });
    await calendar.events.delete({ calendarId: "primary", eventId });
    return true;
  } catch (err) {
    console.error("[calendar] deleteEvent failed:", err.message);
    return false;
  }
}

module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  saveTokensForUser,
  createEventForUser,
  updateEventForUser,
  deleteEventForUser,
};
