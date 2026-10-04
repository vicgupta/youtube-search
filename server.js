process.loadEnvFile();

const http = require("http");
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");
const yts = require("yt-search");
const { YoutubeTranscript } = require("youtube-transcript");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL. Copy .env.example to .env and paste your Supabase database URL.");
  process.exit(1);
}

// Supabase requires SSL; the pooler URL goes in DATABASE_URL.
// prepare:false because Supabase's pooler runs in transaction mode,
// which doesn't support server-side prepared statements.
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false });

async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS videos (
      videoId TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      channel TEXT,
      author_url TEXT,
      url TEXT,
      thumbnail TEXT,
      description TEXT,
      views BIGINT,
      duration_seconds INTEGER,
      duration_label TEXT,
      published_ago TEXT,
      transcript TEXT,
      transcript_lang TEXT,
      transcript_fetched_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS searches (
      id SERIAL PRIMARY KEY,
      keyword TEXT NOT NULL,
      result_count INTEGER,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;
}

async function upsertVideo(v) {
  await sql`
    INSERT INTO videos (videoId, title, channel, author_url, url, thumbnail, description, views, duration_seconds, duration_label, published_ago, updated_at)
    VALUES (${v.videoId}, ${v.title}, ${v.channel}, ${v.author_url}, ${v.url}, ${v.thumbnail}, ${v.description}, ${v.views}, ${v.duration_seconds}, ${v.duration_label}, ${v.published_ago}, now())
    ON CONFLICT (videoId) DO UPDATE SET
      title = EXCLUDED.title, channel = EXCLUDED.channel, author_url = EXCLUDED.author_url,
      url = EXCLUDED.url, thumbnail = EXCLUDED.thumbnail, description = EXCLUDED.description,
      views = EXCLUDED.views, duration_seconds = EXCLUDED.duration_seconds,
      duration_label = EXCLUDED.duration_label, published_ago = EXCLUDED.published_ago,
      updated_at = now()
  `;
}

async function getCachedTranscript(videoId) {
  const rows = await sql`SELECT transcript FROM videos WHERE videoId = ${videoId} AND transcript_lang = 'en'`;
  return rows[0]?.transcript;
}

async function saveTranscript(videoId, transcript) {
  await sql`
    INSERT INTO videos (videoId, title, transcript, transcript_lang, transcript_fetched_at, updated_at)
    VALUES (${videoId}, '', ${transcript}, 'en', now(), now())
    ON CONFLICT (videoId) DO UPDATE SET
      transcript = EXCLUDED.transcript,
      transcript_lang = 'en',
      transcript_fetched_at = EXCLUDED.transcript_fetched_at,
      updated_at = now()
  `;
}

async function logSearch(keyword, resultCount) {
  await sql`INSERT INTO searches (keyword, result_count) VALUES (${keyword}, ${resultCount})`;
}

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
        await upsertVideo({
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
        const cached = await getCachedTranscript(v.videoId);
        results.push({
          videoId: v.videoId,
          title: v.title,
          channel: v.author?.name || "",
          url: v.url,
          thumbnail: v.thumbnail,
          hasTranscript: !!cached,
        });
      }
      await logSearch(q, results.length);
      return json(res, 200, { results });
    } catch (err) {
      return json(res, 502, { error: "Search failed. Try again." });
    }
  }

  if (url.pathname === "/api/transcript" && req.method === "GET") {
    const videoId = (url.searchParams.get("videoId") || "").trim();
    if (!videoId) return json(res, 400, { error: "Missing ?videoId=" });
    try {
      const cached = await getCachedTranscript(videoId);
      if (cached) return json(res, 200, { videoId, transcript: cached, cached: true });
      const lines = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
      const transcript = lines.map((l) => l.text).join(" ");
      await saveTranscript(videoId, transcript);
      return json(res, 200, { videoId, transcript, cached: false });
    } catch (err) {
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

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Search app: http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Could not connect to the database. Check DATABASE_URL in .env:", err.message);
    process.exit(1);
  });
