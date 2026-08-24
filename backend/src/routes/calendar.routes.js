const router = require("express").Router();
const { requireAuth } = require("../middleware/auth.middleware");
const calendarService = require("../services/calendar.service");

// Step 1: logged-in user (patient or doctor) requests the Google consent URL
router.get("/oauth/start", requireAuth, (req, res) => {
  const url = calendarService.getAuthUrl(req.user.id);
  res.json({ url });
});

// Step 2: Google redirects here with a code; state = userId we passed in step 1
router.get("/oauth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send("Missing code/state");

  try {
    const tokens = await calendarService.exchangeCodeForTokens(String(code));
    await calendarService.saveTokensForUser(String(state), tokens);
    res.redirect(`${process.env.FRONTEND_URL}/calendar-connected`);
  } catch (err) {
    res.status(500).send(`Calendar connection failed: ${err.message}`);
  }
});

module.exports = router;
