// Local dev server (npm start). Production on Vercel uses the
// serverless functions in api/, which share lib/db.js with this file.
const http = require("http");
const fs = require("fs");
const path = require("path");
const yts = require("yt-search");
const { YoutubeTranscript } = require("youtube-transcript");
const db = require("./lib/db");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

function json(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/search" && req.method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return json(res, 400, { error: "Missing ?q= keyword" });
    try {
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
      return json(res, 200, { results });
    } catch (err) {
      if (db.isMissingDbUrl(err)) return json(res, 500, { error: err.message });
      return json(res, 502, { error: "Search failed. Try again." });
    }
  }

  if (url.pathname === "/api/transcript" && req.method === "GET") {
    const videoId = (url.searchParams.get("videoId") || "").trim();
    if (!videoId) return json(res, 400, { error: "Missing ?videoId=" });
    try {
      const cached = await db.getCachedTranscript(videoId);
      if (cached) return json(res, 200, { videoId, transcript: cached, cached: true });
      const lines = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
      const transcript = lines.map((l) => l.text).join(" ");
      await db.saveTranscript(videoId, transcript);
      return json(res, 200, { videoId, transcript, cached: false });
    } catch (err) {
      if (db.isMissingDbUrl(err)) return json(res, 500, { error: err.message });
      return json(res, 404, { error: "No English transcript available for this video." });
    }
  }

  // Static files (no directory traversal)
  const safePath = path.normalize(url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }
  serveFile(res, filePath);
});

db.initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Search app: http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Could not connect to the database. Check DATABASE_URL in .env:", err.message);
    process.exit(1);
  });
