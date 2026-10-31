/* Jarvis phone app (PWA). Talks to the same Supabase project as the PC.
   Everything except Supabase, OpenStreetMap services, Wikipedia and Open-Meteo stays on the phone. */
"use strict";
const SUPABASE_URL = "https://qmnxooigacnudpknrdzg.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtbnhvb2lnYWNudWRwa25yZHpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0ODI0MDksImV4cCI6MjEwOTA1ODQwOX0.t7bKeaHAeXyHvt1zVFqOECSI7ndPiHfEKhXd9IRbkXI";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = (id) => document.getElementById(id);
const fold = (s) => (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").toLowerCase()
  .replace(/[’'"“”.,!?;:]/g, " ").replace(/\s+/g, " ").trim();

/* ---------------- voice ---------------- */
let voice = null, muted = false;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter(v => v.lang.startsWith("en"));
  voice = vs.find(v => /Daniel|Arthur|Samantha|Karen/.test(v.name)) || vs[0] || null;
}
speechSynthesis.onvoiceschanged = pickVoice; pickVoice();
function say(text, card) {
  $("reply").textContent = text;
  if (card) showCard(card.title, card.body);
  if (muted || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/https?:\S+/g, ""));
  if (voice) u.voice = voice;
  u.rate = 1.04;
  setOrb("speaking");
  u.onend = () => setOrb("");
  speechSynthesis.speak(u);
}
function setOrb(s) {
  $("orb").className = "orb " + s;
  $("state").textContent = { listening: "Listening…", thinking: "Thinking…", speaking: "Speaking" }[s] || "Tap the orb and speak";
}
function showCard(title, body) {
  const c = $("card"); c.hidden = !title && !body; c.innerHTML = "";
  if (title) { const h = document.createElement("h3"); h.textContent = title; c.appendChild(h); }
  if (body instanceof Node) c.appendChild(body); else if (body) c.appendChild(document.createTextNode(body));
}

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
function listen() {
  speechSynthesis.cancel();
  if (!SR) { $("typeInput").focus(); say("Voice input isn't available here. Use the keyboard microphone to dictate."); return; }
  if (rec) { rec.stop(); return; }
  rec = new SR(); rec.lang = "en-US"; rec.interimResults = true; rec.maxAlternatives = 1;
  let final = "";
  rec.onresult = (e) => {
    let t = ""; for (const r of e.results) t += r[0].transcript;
    $("heard").textContent = t; if (e.results[e.results.length - 1].isFinal) final = t;
  };
  rec.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") say("Microphone error: " + e.error); };
  rec.onend = () => { rec = null; setOrb(""); if (final.trim()) handle(final.trim()); };
  setOrb("listening"); rec.start();
}

/* ---------------- time parsing for reminders ---------------- */
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty five": 45, half: 0.5 };
function parseWhen(text) {
  let t = " " + fold(text) + " ", due = null;
  const num = (x) => (isNaN(+x) ? NUM[x] : +x);
  let m = t.match(/ in (\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty five|forty|half an?) ?(minutes?|mins?|hours?|hrs?|days?|seconds?|secs?) /);
  if (m) {
    const n = m[1].startsWith("half") ? 0.5 : num(m[1]); const u = m[2][0];
    due = new Date(Date.now() + n * (u === "h" ? 3600e3 : u === "d" ? 864e5 : u === "s" ? 1e3 : 60e3));
    t = t.replace(m[0], " ");
  } else {
    m = t.match(/ (?:at |by )(\d{1,2})(?: (\d{2})|:(\d{2}))? ?(am|pm|a m|p m)? /) || t.match(/ (\d{1,2})(?: (\d{2}))? ?(am|pm|a m|p m) /);
    let day = 0;
    if (/ tomorrow /.test(t)) { day = 1; t = t.replace(" tomorrow ", " "); }
    if (/ tonight /.test(t) && !m) { due = new Date(); due.setHours(20, 0, 0, 0); t = t.replace(" tonight ", " "); }
    if (/ (this )?morning /.test(t) && !m && day) { due = new Date(Date.now() + 864e5); due.setHours(9, 0, 0, 0); }
    if (m) {
      let h = +m[1]; const mi = +(m[2] || m[3] || 0); const ap = (m[4] || m[3] || "").replace(" ", "");
      if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0;
      due = new Date(); due.setDate(due.getDate() + day); due.setHours(h, mi, 0, 0);
      if (!day && due < new Date()) due.setDate(due.getDate() + 1);
      t = t.replace(m[0], " ");
    } else if (day && !due) { due = new Date(Date.now() + 864e5); due.setHours(9, 0, 0, 0); }
  }
  return { due, rest: t.trim() };
}
const hhmm = (d) => d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });

/* ---------------- intents ---------------- */
async function handle(raw) {
  const f = fold(raw);
  $("heard").textContent = raw; setOrb("thinking");
  try {
    let m;
    // PC control
    if ((m = f.match(/^(?:(?:on|tell)\s+(?:my\s+)?(?:pc|computer|laptop)\s+(?:to\s+)?)(.+)$/)) ||
        (m = f.match(/^(.+?)\s+on\s+(?:my\s+|the\s+)?(?:pc|computer|laptop)$/)))
      return sendToPC(m[1]);
    // reminders
    if ((m = f.match(/^(?:remind me|set a reminder|reminder)\s*(?:to|about|that)?\s*(.+)$/))) {
      const { due, rest } = parseWhen(m[1]);
      const text = rest.replace(/^(?:to|about|that)\s+/, "").trim();
      if (!due) return say("When should I remind you? For example: remind me to call mom at 6 pm.");
      const { error } = await sb.from("reminders").insert({ text, due_at: due.toISOString(), source: "phone" });
      if (error) throw error;
      scheduleLocal(text, due);
      return say(`Okay. I'll remind you to ${text}, ${hhmm(due)}.`);
    }
    if (/\b(?:my reminders|what do i have|any reminders|list reminders)\b/.test(f)) return listReminders(true);
    // notes / memory
    if ((m = f.match(/^(?:remember(?: that)?|take a note|note|make a note(?: that)?)\s+(.+)$/))) {
      const { error } = await sb.from("notes").insert({ text: m[1], source: "phone" });
      if (error) throw error;
      return say("Got it. I'll remember that.");
    }
    if (/\b(?:my notes|what do you remember|read my notes)\b/.test(f)) return listNotes(true);
    // navigation
    if ((m = f.match(/^(?:(?:create|make|plan|find|get|show|give)\s+(?:me\s+)?(?:a\s+)?(?:route|directions|the way)|route|directions|navigate|take me|drive|walk|how do i get|guide me)\s+(?:me\s+)?(?:to|towards|for)\s+(?:the\s+|a\s+)?(.+)$/)) ||
        (m = f.match(/^(?:where is\s+|find\s+)?(?:the\s+)?((?:nearest|closest)\s+.+)$/))) {
      const mode = /^walk|on foot|walking/.test(f) ? "foot" : "car";
      return startNav(m[1].replace(/^(nearest|closest)\s+/, "nearest "), mode);
    }
    // music
    if ((m = f.match(/^(?:play|put on|listen to)\s+(.+?)(?:\s+on\s+spotify)?$/)) && !/youtube/.test(f)) {
      location.href = "spotify:search:" + encodeURIComponent(m[1]);
      return say("Opening " + m[1] + " on Spotify.");
    }
    if ((m = f.match(/^(?:play|watch|search|open)\s+(.+?)\s+on\s+youtube$/))) {
      location.href = "https://www.youtube.com/results?search_query=" + encodeURIComponent(m[1]);
      return say("Opening YouTube.");
    }
    // briefing / time / weather
    if (/\b(?:brief|briefing|good morning|morning summary)\b/.test(f)) return briefing();
    if (/\bwhat time\b|\btime is it\b/.test(f)) return say("It's " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + ".");
    if (/\bweather\b/.test(f)) { const w = await weather(); return say(w || "I couldn't get the weather."); }
    // questions -> Wikipedia
    if ((m = f.match(/^(?:what|who)\s+(?:is|are|was|were)\s+(?:a\s+|an\s+|the\s+)?(.+)$/)) || (m = f.match(/^(?:tell me about|search|explain|define)\s+(.+)$/)))
      return wiki(m[1]);
    // anything else: let the PC's brain handle it if it is on
    return sendToPC(raw, true);
  } catch (e) {
    console.error(e); say("Something went wrong: " + (e.message || e));
  }
}

async function sendToPC(text, fallback) {
  const { data, error } = await sb.from("commands").insert({ target: "pc", text }).select("id").single();
  if (error) throw error;
  say(fallback ? "I sent that to your PC." : "Sent to your PC.");
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const { data: c } = await sb.from("commands").select("status").eq("id", data.id).single();
    if (c && c.status !== "pending") { $("pcDot").classList.add("on"); $("reply").textContent = "Your PC got it ✓"; return; }
  }
  $("pcDot").classList.remove("on");
  $("reply").textContent = "Your PC seems to be off. It will run this when it's back on.";
}

async function wiki(q) {
  const r = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(q.trim()));
  if (!r.ok) return sendToPC("what is " + q, true);
  const d = await r.json();
  const first = (d.extract || "").split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  say(first || "I couldn't find that.", { title: d.title, body: d.extract });
}

/* ---------------- reminders & notes ---------------- */
async function listReminders(speak) {
  const { data, error } = await sb.from("reminders").select("id,text,due_at,done").eq("done", false).order("due_at").limit(50);
  if (error) throw error;
  const box = document.createElement("div");
  for (const r of data) {
    const row = document.createElement("div"); row.className = "item";
    row.innerHTML = `<span class="when"></span><span class="txt"></span><button class="x">✓</button>`;
    row.querySelector(".when").textContent = r.due_at ? hhmm(new Date(r.due_at)) : "";
    row.querySelector(".txt").textContent = r.text;
    row.querySelector(".x").onclick = async () => { await sb.from("reminders").update({ done: true }).eq("id", r.id); row.remove(); };
    box.appendChild(row);
  }
  openPanel("REMINDERS", data.length ? box : "No reminders.");
  if (speak) {
    const soon = data.filter(r => r.due_at && new Date(r.due_at) - Date.now() < 864e5);
    say(soon.length ? `You have ${soon.length} reminder${soon.length > 1 ? "s" : ""}. ` + soon.slice(0, 3).map(r => `${hhmm(new Date(r.due_at))}: ${r.text}`).join(". ") : "Nothing in the next 24 hours.");
  }
  data.forEach(r => r.due_at && scheduleLocal(r.text, new Date(r.due_at)));
}
async function listNotes(speak) {
  const { data, error } = await sb.from("notes").select("text,created_at").order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  const box = document.createElement("div");
  data.forEach(n => { const d = document.createElement("div"); d.className = "item"; d.textContent = n.text; box.appendChild(d); });
  openPanel("NOTES", data.length ? box : "No notes yet.");
  if (speak) say(data.length ? "Here is what I remember. " + data.slice(0, 3).map(n => n.text).join(". ") : "I don't have any notes yet.");
}
function openPanel(title, body) {
  const p = $("panel"); p.innerHTML = ""; p.hidden = false;
  const h = document.createElement("h3"); h.textContent = title; p.appendChild(h);
  if (body instanceof Node) p.appendChild(body); else { const d = document.createElement("div"); d.textContent = body; p.appendChild(d); }
}
// while the app is open, reminders also fire here (with a notification if allowed)
const timers = new Map();
function scheduleLocal(text, due) {
  const ms = due - Date.now(), key = text + due.getTime();
  if (ms <= 0 || ms > 864e5 || timers.has(key)) return;
  timers.set(key, setTimeout(() => {
    say("Reminder: " + text);
    if (window.Notification && Notification.permission === "granted") new Notification("Jarvis", { body: text, icon: "icons/icon-192.png" });
  }, ms));
}

/* ---------------- briefing ---------------- */
function here() {
  return new Promise((ok, no) => navigator.geolocation.getCurrentPosition(p => ok([p.coords.latitude, p.coords.longitude]), no,
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }));
}
async function weather() {
  try {
    const [la, lo] = await here();
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`);
    const d = await r.json();
    const code = d.current.weather_code;
    const desc = code === 0 ? "clear" : code < 4 ? "partly cloudy" : code < 50 ? "foggy" : code < 70 ? "rainy" : code < 80 ? "snowy" : "stormy";
    return `It's ${Math.round(d.current.temperature_2m)} degrees and ${desc}. Today ${Math.round(d.daily.temperature_2m_min[0])} to ${Math.round(d.daily.temperature_2m_max[0])}, ${d.daily.precipitation_probability_max[0]}% chance of rain.`;
  } catch { return ""; }
}
async function briefing() {
  const now = new Date(), h = now.getHours();
  const greet = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const date = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const [w, rem] = await Promise.all([weather(), sb.from("reminders").select("text,due_at").eq("done", false)
    .gte("due_at", now.toISOString()).lte("due_at", new Date(+now + 864e5).toISOString()).order("due_at")]);
  const items = (rem.data || []).map(r => `${new Date(r.due_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${r.text}`);
  const text = `${greet}. It's ${date}. ${w} ` + (items.length ? `You have ${items.length} thing${items.length > 1 ? "s" : ""} today: ${items.slice(0, 4).join(", ")}.` : "Your day is clear.");
  say(text, { title: "BRIEFING", body: `${date}\n${w}\n\n${items.join("\n") || "No reminders today."}` });
}

/* ---------------- navigation ---------------- */
const CAT = { "gas station": "fuel", "petrol station": "fuel", fuel: "fuel", gas: "fuel", pharmacy: "pharmacy", hospital: "hospital",
  atm: "atm", bank: "bank", cafe: "cafe", coffee: "cafe", "coffee shop": "cafe", restaurant: "restaurant", parking: "parking",
  "charging station": "charging_station", police: "police", toilet: "toilets", "post office": "post_office" };
let map, routeLine, meMarker, destMarker, nav = null, watchId = null, wakeLock = null;
const km = (a, b) => { const R = 6371, dLa = (b[0] - a[0]) * Math.PI / 180, dLo = (b[1] - a[1]) * Math.PI / 180;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x)); };
const fmtD = (m) => m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m / 10) * 10 + " m";
const fmtT = (s) => { const m = Math.max(1, Math.round(s / 60)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

async function findDest(q, pos) {
  const f = fold(q).replace(/^nearest /, ""), cat = CAT[f] || CAT[f.replace(/s$/, "")];
  if (q.startsWith("nearest") || cat) {
    for (const d of [0.03, 0.1, 0.3]) {
      const vb = `${pos[1] - d * 1.4},${pos[0] + d},${pos[1] + d * 1.4},${pos[0] - d}`;
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=25&bounded=1&viewbox=${vb}&` + (cat ? "amenity=" + cat : "q=" + encodeURIComponent(f));
      const res = await (await fetch(url)).json();
      if (res.length) {
        const best = res.map(x => ({ name: x.name || f, at: [+x.lat, +x.lon] })).sort((a, b) => km(pos, a.at) - km(pos, b.at))[0];
        return best;
      }
    }
    return null;
  }
  const r = await fetch(`https://photon.komoot.io/api/?limit=1&lat=${pos[0]}&lon=${pos[1]}&q=` + encodeURIComponent(q)).then(r => r.json()).catch(() => null);
  const ft = r && r.features && r.features[0];
  if (ft) return { name: ft.properties.name, at: [ft.geometry.coordinates[1], ft.geometry.coordinates[0]] };
  const n = await (await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + encodeURIComponent(q))).json();
  return n[0] ? { name: n[0].name || q, at: [+n[0].lat, +n[0].lon] } : null;
}
async function osrm(a, b, mode) {
  const host = mode === "foot" ? "routed-foot/route/v1/foot" : "routed-car/route/v1/driving";
  const r = await (await fetch(`https://routing.openstreetmap.de/${host}/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson&steps=true`)).json();
  if (r.code !== "Ok") return null;
  const rt = r.routes[0], steps = [];
  for (const s of rt.legs[0].steps) {
    const m = s.maneuver, road = s.name ? " onto " + s.name : "";
    const txt = { depart: "Head " + (m.modifier || "out") + road, arrive: "You have arrived", turn: `Turn ${m.modifier}${road}`,
      "end of road": `Turn ${m.modifier}${road}`, fork: `Keep ${m.modifier}${road}`, merge: "Merge" + road,
      roundabout: `At the roundabout take exit ${m.exit || ""}${road}`, rotary: `At the roundabout take exit ${m.exit || ""}${road}`,
      "on ramp": "Take the ramp" + road, "off ramp": "Take the exit" + road,
      continue: (m.modifier && !/straight|uturn/.test(m.modifier) ? "Keep " + m.modifier : "Continue") + road,
      "new name": "Continue" + road }[m.type] || ("Continue" + road);
    steps.push({ text: txt, at: [m.location[1], m.location[0]], mod: m.modifier || "", type: m.type, said: 0 });
  }
  return { path: rt.geometry.coordinates.map(c => [c[1], c[0]]), dist: rt.distance, time: rt.duration, steps };
}
const ARROW = { left: "←", right: "→", "sharp left": "↰", "sharp right": "↱", "slight left": "↖", "slight right": "↗", uturn: "↶", straight: "↑" };

async function startNav(target, mode) {
  say("Finding a route…");
  let pos; try { pos = await here(); } catch { return say("I need your location. Allow location access for Jarvis in Settings."); }
  const dest = await findDest(target, pos);
  if (!dest) return say("I couldn't find " + target + ".");
  const rt = await osrm(pos, dest.at, mode);
  if (!rt) return say("I couldn't calculate a route.");
  nav = { dest, mode, rt, step: 1, off: 0, start: pos };
  $("main").hidden = true; $("nav").hidden = false;
  if (!map) {
    map = L.map("map", { zoomControl: false, attributionControl: true }).setView(pos, 16);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  }
  setTimeout(() => map.invalidateSize(), 50);
  drawRoute();
  meMarker = meMarker || L.marker(pos, { icon: L.divIcon({ className: "", html: '<div class="me"></div>', iconSize: [20, 20] }) }).addTo(map);
  destMarker && destMarker.remove();
  destMarker = L.circleMarker(dest.at, { radius: 11, color: "#ffb23c", weight: 3, fillOpacity: .3 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [90, 60] });
  const links = navLinks(pos, dest.at, mode);
  $("navGoogle").onclick = () => location.href = links.google;
  $("navWaze").onclick = () => location.href = links.waze;
  $("navYandex").onclick = () => location.href = links.yandex;
  updateNavUI(pos);
  say(`${dest.name}. ${fmtD(rt.dist)}, about ${fmtT(rt.time)}. ${rt.steps[0].text}.`);
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch {}
  watchId = navigator.geolocation.watchPosition(onMove, () => {}, { enableHighAccuracy: true, maximumAge: 2000 });
}
function drawRoute() {
  routeLine && routeLine.remove();
  routeLine = L.layerGroup([L.polyline(nav.rt.path, { color: "#00506e", weight: 12, opacity: .9 }),
    L.polyline(nav.rt.path, { color: "#ffbe3c", weight: 6 })]).addTo(map);
  routeLine.getBounds = () => L.latLngBounds(nav.rt.path);
}
function navLinks(a, b, mode) {
  return { google: `https://www.google.com/maps/dir/?api=1&origin=${a[0]},${a[1]}&destination=${b[0]},${b[1]}&travelmode=${mode === "foot" ? "walking" : "driving"}`,
    waze: `https://waze.com/ul?ll=${b[0]},${b[1]}&navigate=yes`,
    yandex: `yandexnavi://build_route_on_map?lat_to=${b[0]}&lon_to=${b[1]}` };
}
function distToPath(p, path) { let best = 1e9; for (let i = 0; i < path.length; i += 2) best = Math.min(best, km(p, path[i])); return best * 1000; }
async function onMove(g) {
  if (!nav) return;
  const p = [g.coords.latitude, g.coords.longitude];
  meMarker.setLatLng(p); map.panTo(p, { animate: true });
  const off = distToPath(p, nav.rt.path);
  if (off > 60) {                               // off the route: recalculate after 3 bad fixes
    if (++nav.off >= 3) { nav.off = 0; say("Recalculating."); const rt = await osrm(p, nav.dest.at, nav.mode); if (rt) { nav.rt = rt; nav.step = 1; drawRoute(); } }
  } else nav.off = 0;
  updateNavUI(p);
}
function updateNavUI(p) {
  const s = nav.rt.steps[Math.min(nav.step, nav.rt.steps.length - 1)];
  const d = km(p, s.at) * 1000;
  if (d < 25 && nav.step < nav.rt.steps.length - 1) { nav.step++; return updateNavUI(p); }
  $("navInstr").textContent = s.text; $("navSub").textContent = "in " + fmtD(d);
  $("navArrow").textContent = s.type === "arrive" ? "◎" : (ARROW[s.mod] || "↑");
  const left = km(p, nav.dest.at) * 1000, ratio = Math.min(1, left / Math.max(1, nav.rt.dist));
  const eta = new Date(Date.now() + nav.rt.time * ratio * 1000);
  $("navEta").innerHTML = `<b>${fmtT(nav.rt.time * ratio)}</b> · ${fmtD(left)} · arrive ${eta.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (s.said === 0 && d < (nav.mode === "foot" ? 60 : 250)) { s.said = 1; say(`In ${fmtD(d)}, ${s.text}.`); }
  else if (s.said === 1 && d < (nav.mode === "foot" ? 15 : 40)) { s.said = 2; say(s.text + "."); }
  if (s.type === "arrive" && left < 30) { say("You have arrived."); endNav(); }
}
function endNav() {
  nav = null; watchId !== null && navigator.geolocation.clearWatch(watchId); watchId = null;
  wakeLock && wakeLock.release().catch(() => {}); wakeLock = null;
  $("nav").hidden = true; $("main").hidden = false;
}

/* ---------------- help ---------------- */
const HELP = `Talk or type:
• Remind me to call mom at 6 pm / in 20 minutes / tomorrow at 9
• Remember that my exam is on Monday · What do you remember?
• What are my reminders? · Good morning (briefing) · Weather
• Route to the nearest gas station · Walk to the nearest pharmacy · Navigate to Kadıköy
• Play Daft Punk on Spotify · Play lofi on YouTube
• Pause the music on my PC · On my PC open Spotify
• What is a black hole? · Who is Tesla?
Anything else goes to your PC's Jarvis when it is on.`;

/* ---------------- wiring ---------------- */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  $("login").hidden = !!session; $("main").hidden = !session;
  if (session) {
    listReminders(false).then(() => ($("panel").hidden = true)).catch(() => {});
    if (new URLSearchParams(location.search).has("listen")) setTimeout(listen, 400);
  }
}
$("loginForm").onsubmit = async (e) => {
  e.preventDefault(); $("loginMsg").textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
  if (error) { $("loginMsg").textContent = error.message; return; }
  $("password").value = ""; boot();
};
$("orb").onclick = listen;
$("typeForm").onsubmit = (e) => { e.preventDefault(); const v = $("typeInput").value.trim(); $("typeInput").value = ""; $("typeInput").blur(); if (v) handle(v); };
$("briefBtn").onclick = briefing;
$("menuBtn").onclick = async () => {
  if (window.Notification && Notification.permission === "default") await Notification.requestPermission();
  openPanel("ACCOUNT", "");
  const b = document.createElement("button"); b.className = "chip"; b.textContent = "Sign out";
  b.onclick = async () => { await sb.auth.signOut(); $("panel").hidden = true; boot(); };
  $("panel").appendChild(b);
};
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => {
  const v = b.dataset.view; const p = $("panel");
  if (!p.hidden && p.dataset.view === v) { p.hidden = true; return; }
  p.dataset.view = v;
  (v === "reminders" ? listReminders(false) : v === "notes" ? listNotes(false) : Promise.resolve(openPanel("COMMANDS", HELP))).catch(e => say(e.message));
});
$("hud").onclick = (e) => { if (e.target.id !== "orb") $("panel").hidden = true; };
$("navEnd").onclick = () => { endNav(); say("Navigation ended."); };
$("navMute").onclick = () => { muted = !muted; $("navMute").textContent = muted ? "🔇" : "🔊"; speechSynthesis.cancel(); };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
