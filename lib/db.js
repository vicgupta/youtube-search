// Shared Postgres layer, used by both the local server.js and the
// Vercel serverless functions in api/. The client is created lazily and
// cached so warm serverless invocations reuse the connection.
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(); // no-op on Vercel (no .env file); env comes from the dashboard
  } catch (err) {
    // ignore — DATABASE_URL may be provided by the environment
  }
}

const postgres = require("postgres");

let sql = null;
let initPromise = null;

function isMissingDbUrl(err) {
  return err && typeof err.message === "string" && err.message.startsWith("Missing DATABASE_URL");
}

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "Missing DATABASE_URL. Set it in .env (local) or the Vercel dashboard (Project → Settings → Environment Variables)."
    );
  }
  if (!sql) {
    // prepare:false — Supabase's pooler runs in transaction mode, which
    // doesn't support server-side prepared statements. max:1 keeps
    // serverless instances to a single connection.
    sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1, onnotice: () => {} });
  }
  return sql;
}

async function initDb() {
  if (!initPromise) {
    initPromise = (async () => {
      const db = getSql();
      await db`
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
      await db`
        CREATE TABLE IF NOT EXISTS searches (
          id SERIAL PRIMARY KEY,
          keyword TEXT NOT NULL,
          result_count INTEGER,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `;
    })().catch((err) => {
      initPromise = null; // allow retry on next invocation
      throw err;
    });
  }
  return initPromise;
}

async function upsertVideo(v) {
  const db = getSql();
  await db`
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
  const db = getSql();
  const rows = await db`SELECT transcript FROM videos WHERE videoId = ${videoId} AND transcript_lang = 'en'`;
  return rows[0]?.transcript;
}

async function saveTranscript(videoId, transcript) {
  const db = getSql();
  await db`
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
  const db = getSql();
  await db`INSERT INTO searches (keyword, result_count) VALUES (${keyword}, ${resultCount})`;
}

module.exports = { initDb, upsertVideo, getCachedTranscript, saveTranscript, logSearch, isMissingDbUrl };
