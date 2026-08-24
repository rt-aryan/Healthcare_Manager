// Catches anything thrown/rejected in route handlers (thanks to express-async-errors)
// so a single bad request never crashes the whole server process.
function errorHandler(err, req, res, next) {
  console.error("[error]", err);

  if (err.code === "P2002") {
    return res.status(409).json({ error: "Conflict: a unique constraint was violated" });
  }
  if (err.code === "P2025") {
    return res.status(404).json({ error: "Record not found" });
  }

  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
}

module.exports = errorHandler;
