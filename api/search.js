const yts = require("yt-search");
const db = require("../lib/db");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const q = (req.query?.q || "").trim();
  if (!q) return res.status(400).json({ error: "Missing ?q= keyword" });

  try {
    await db.initDb();
    const r = await yts(q);
    const videos = (r.videos || []).slice(0, 10);
    const results = [];
    for (const v of videos) {
      await db.upsertVideo({
        videoId: v.videoId,
        title: v.title,
        channel: v.author?.name || "",
        author_url: v.author?.url || "",
        url: v.url,
        thumbnail: v.thumbnail,
        description: v.description || "",
        views: v.views ?? null,
        duration_seconds: v.seconds ?? v.duration?.seconds ?? null,
        duration_label: v.timestamp || "",
        published_ago: v.ago || "",
      });
      const cached = await db.getCachedTranscript(v.videoId);
      results.push({
        videoId: v.videoId,
        title: v.title,
        channel: v.author?.name || "",
        url: v.url,
        thumbnail: v.thumbnail,
        hasTranscript: !!cached,
      });
    }
    await db.logSearch(q, results.length);
    return res.status(200).json({ results });
  } catch (err) {
    if (db.isMissingDbUrl(err)) return res.status(500).json({ error: err.message });
    console.error("search failed:", err.message);
    return res.status(502).json({ error: "Search failed. Try again." });
  }
};
