const { YoutubeTranscript } = require("youtube-transcript");
const db = require("../lib/db");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const videoId = (req.query?.videoId || "").trim();
  if (!videoId) return res.status(400).json({ error: "Missing ?videoId=" });

  try {
    await db.initDb();
    const cached = await db.getCachedTranscript(videoId);
    if (cached) return res.status(200).json({ videoId, transcript: cached, cached: true });
    const lines = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
    const transcript = lines.map((l) => l.text).join(" ");
    await db.saveTranscript(videoId, transcript);
    return res.status(200).json({ videoId, transcript, cached: false });
  } catch (err) {
    if (db.isMissingDbUrl(err)) return res.status(500).json({ error: err.message });
    console.error("transcript failed:", err.message);
    return res.status(404).json({ error: "No English transcript available for this video." });
  }
};
