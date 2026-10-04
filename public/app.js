const form = document.getElementById("searchForm");
const keywordInput = document.getElementById("keyword");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  const original = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(() => { btn.textContent = original; }, 1500);
}

async function toggleTranscript(videoId, btn, box, copyBtn) {
  if (!box.hidden) {
    box.hidden = true;
    copyBtn.hidden = true;
    btn.textContent = "Transcript";
    return;
  }
  if (box.dataset.loaded === "1") {
    box.hidden = false;
    copyBtn.hidden = false;
    btn.textContent = "Hide transcript";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Loading…";
  try {
    const res = await fetch(`/api/transcript?videoId=${encodeURIComponent(videoId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    box.textContent = data.transcript;
    box.dataset.loaded = "1";
    box.hidden = false;
    copyBtn.hidden = false;
    btn.textContent = "Hide transcript";
  } catch (err) {
    box.textContent = err.message;
    box.dataset.loaded = "";
    box.hidden = false;
    btn.textContent = "Retry transcript";
  } finally {
    btn.disabled = false;
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const keyword = keywordInput.value.trim();
  resultsEl.innerHTML = "";

  if (!keyword) {
    setStatus("Please enter a keyword.", true);
    return;
  }

  setStatus(`Searching for "${keyword}"…`);
  form.querySelector("button").disabled = true;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(keyword)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

    if (data.results.length === 0) {
      setStatus(`No results for "${keyword}".`);
      return;
    }

    setStatus(`${data.results.length} result(s) for "${keyword}":`);
    for (const { videoId, title, channel, url, thumbnail, hasTranscript } of data.results) {
      const li = document.createElement("li");
      if (thumbnail) {
        const img = document.createElement("img");
        img.src = thumbnail;
        img.alt = "";
        img.loading = "lazy";
        img.width = 160;
        li.appendChild(img);
      }
      const div = document.createElement("div");
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = title;
      div.appendChild(a);
      if (channel) {
        const small = document.createElement("small");
        small.textContent = channel;
        div.appendChild(small);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "transcript-btn";
      btn.textContent = hasTranscript ? "Transcript (saved)" : "Transcript";
      const box = document.createElement("p");
      box.className = "transcript";
      box.hidden = true;
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "transcript-btn";
      copyBtn.textContent = "Copy";
      copyBtn.hidden = true;
      copyBtn.addEventListener("click", () => copyText(box.textContent, copyBtn));
      btn.addEventListener("click", () => toggleTranscript(videoId, btn, box, copyBtn));
      div.appendChild(btn);
      div.appendChild(copyBtn);
      div.appendChild(box);
      li.appendChild(div);
      resultsEl.appendChild(li);
    }
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    form.querySelector("button").disabled = false;
  }
});
