/* Gedeelde speler + navigatie binnen de site: alleen .wrap wisselt, de speler blijft doorspelen. */
(function () {
  const ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z"/></svg>';
  const KEY = "pra-positions";
  const ss = {
    get() { try { return JSON.parse(sessionStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } },
    set(v) { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  };
  const positions = ss.get();
  const audio = new Audio();
  audio.preload = "none";
  let current = null;      // {id, url, name, sub}
  let barOpen = false;
  const listeners = [];

  const bar = document.createElement("div");
  bar.className = "player";
  bar.hidden = true;
  bar.innerHTML = '<button type="button" class="play" data-p="toggle"></button>' +
    '<div class="pinfo"><span class="pname"></span><span class="psub"></span>' +
    '<div class="seek" role="slider" tabindex="0" aria-label="Positie in track" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="bar"><i></i></div></div>' +
    '<span class="ptime">0:00</span></div>' +
    '<button type="button" class="pclose" data-p="close" aria-label="Speler verbergen (pauzeert)">×</button>';
  if (document.body) document.body.appendChild(bar);
  else document.addEventListener("DOMContentLoaded", () => document.body.appendChild(bar));

  const $ = s => bar.querySelector(s);
  const fmt = t => isFinite(t) ? Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0") : "0:00";
  const save = () => { if (current && audio.currentTime > 0) { positions[current.id] = audio.currentTime; ss.set(positions); } };

  function emit() {
    bar.hidden = !(current && barOpen);
    if (current) {
      $(".pname").textContent = current.name;
      $(".psub").textContent = current.sub || "";
      const tg = $("[data-p=toggle]");
      tg.innerHTML = audio.paused ? ICON_PLAY : ICON_PAUSE;
      tg.setAttribute("aria-label", audio.paused ? "Verder afspelen" : "Pauzeer");
    }
    listeners.forEach(fn => fn());
  }
  function progress() {
    const p = audio.duration ? audio.currentTime / audio.duration * 100 : 0;
    $(".bar i").style.width = p + "%";
    $(".seek").setAttribute("aria-valuenow", Math.round(p));
    $(".ptime").textContent = fmt(audio.currentTime) + (audio.duration ? " / " + fmt(audio.duration) : "");
  }

  function toggle(track) {
    if (!track || !track.url) return;
    barOpen = true;
    if (current && current.id === track.id) {
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
      emit();
      return;
    }
    if (current) { save(); audio.pause(); }
    current = track;
    audio.src = track.url;
    const resume = positions[track.id] || 0;
    if (resume) audio.addEventListener("loadedmetadata", function f() { audio.removeEventListener("loadedmetadata", f); if (resume < audio.duration - 1) audio.currentTime = resume; }, { once: true });
    audio.play().catch(() => {});
    emit();
  }
  function seekTo(clientX) {
    const r = $(".seek").getBoundingClientRect();
    if (!audio.duration) return;
    audio.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * audio.duration;
    progress();
  }

  bar.addEventListener("click", e => {
    const b = e.target.closest("[data-p]");
    if (b && b.dataset.p === "toggle") toggle(current);
    if (b && b.dataset.p === "close") { audio.pause(); save(); barOpen = false; emit(); }
  });
  bar.addEventListener("pointerdown", e => { if (e.target.closest(".seek")) seekTo(e.clientX); });
  bar.addEventListener("keydown", e => {
    if (!e.target.closest(".seek") || !audio.duration) return;
    if (e.key === "ArrowRight") audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
    if (e.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 5);
  });
  ["play", "pause", "ended"].forEach(ev => audio.addEventListener(ev, () => { if (ev === "ended" && current) { delete positions[current.id]; ss.set(positions); } else save(); emit(); }));
  audio.addEventListener("timeupdate", () => { progress(); if (Math.floor(audio.currentTime) % 3 === 0) save(); });
  window.addEventListener("pagehide", save);

  let pageCtl = new AbortController();

  window.PR = {
    toggle,
    isCurrent: id => !!current && current.id === id,
    isPlaying: id => !!current && current.id === id && !audio.paused,
    position: id => positions[id] || 0,
    onChange(fn) {
      listeners.push(fn);
      pageCtl.signal.addEventListener("abort", () => { const i = listeners.indexOf(fn); if (i > -1) listeners.splice(i, 1); });
    },
    get signal() { return pageCtl.signal; },
    navigate,
    ICON_PLAY, ICON_PAUSE
  };

  /* ---------- navigatie zonder herladen ---------- */
  const cache = new Map();
  const fetchPage = url => {
    const key = url.split("#")[0];
    if (!cache.has(key)) cache.set(key, fetch(key, { credentials: "same-origin" }).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }).catch(err => { cache.delete(key); throw err; }));
    return cache.get(key);
  };
  function internal(a) {
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return null;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return null;
    if (url.pathname === location.pathname && url.hash) return null;
    return url;
  }
  async function navigate(href, push = true) {
    let html;
    try { html = await fetchPage(href); } catch (e) { location.href = href; return; }
    const doc = new DOMParser().parseFromString(html, "text/html");
    const next = doc.querySelector(".wrap");
    if (!next) { location.href = href; return; }
    if (push) {
      try { history.replaceState({ y: scrollY }, ""); } catch (e) {}
      history.pushState({ y: 0 }, "", href);
    }
    pageCtl.abort();
    pageCtl = new AbortController();
    document.title = doc.title;
    const desc = doc.querySelector('meta[name="description"]');
    const mine = document.querySelector('meta[name="description"]');
    if (desc && mine) mine.setAttribute("content", desc.getAttribute("content"));
    document.querySelector(".wrap").replaceWith(document.adoptNode(next));
    for (const old of doc.querySelectorAll("body > script:not([src])")) {
      const sc = document.createElement("script");
      sc.textContent = "(function(){\n" + old.textContent + "\n})();";
      document.body.appendChild(sc);
      sc.remove();
    }
    emit();
    const y = push ? 0 : (history.state && history.state.y) || 0;
    window.scrollTo(0, y);
  }
  document.addEventListener("click", e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const url = internal(e.target.closest("a[href]"));
    if (!url) return;
    e.preventDefault();
    if (url.href === location.href) return;
    navigate(url.href);
  });
  document.addEventListener("pointerover", e => { const url = internal(e.target.closest && e.target.closest("a[href]")); if (url) fetchPage(url.href).catch(() => {}); }, { passive: true });
  window.addEventListener("popstate", () => navigate(location.href, false));
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
})();
