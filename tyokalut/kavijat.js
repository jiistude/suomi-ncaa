// Hakee GoatCounterista kahden viimeisen täyden viikon (ma–su) kävijätiedot ja tulostaa ne lokiin.
// Avain: GitHubin salaisuus GOATCOUNTER_TOKEN (GoatCounter: User → API, oikeus "Read statistics").
// Tulos on lokissa KAVIJAT-ALKU / KAVIJAT-LOPPU -merkkien välissä (gzip + base64), josta Claude kokoaa raportin.
const zlib = require("zlib");
const TOKEN = process.env.GOATCOUNTER_TOKEN;
const SITE = "https://ncaa.goatcounter.com/api/v0";
if (!TOKEN) { console.log("GOATCOUNTER_TOKEN puuttuu – lisää se repon asetuksiin (Settings → Secrets and variables → Actions)."); process.exit(1); }

const pvm = (d) => d.toISOString().slice(0, 10);
async function api(polku, param) {
  const url = `${SITE}${polku}?${new URLSearchParams(param)}`;
  for (let yritys = 0; yritys < 3; yritys++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } });
    if (r.status === 429) { await new Promise((x) => setTimeout(x, 3000)); continue; }
    if (!r.ok) throw new Error(`${polku}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  throw new Error(`${polku}: liikaa pyyntöjä`);
}

(async () => {
  // Viikot UTC:nä: kuluvaa viikkoa edeltävä maanantai–sunnuntai ja sitä edellinen.
  const nyt = new Date();
  const ma = new Date(Date.UTC(nyt.getUTCFullYear(), nyt.getUTCMonth(), nyt.getUTCDate() - ((nyt.getUTCDay() + 6) % 7)));
  const viikot = [1, 2].map((n) => ({ alku: pvm(new Date(ma - n * 7 * 864e5)), loppu: pvm(new Date(ma - ((n - 1) * 7 + 1) * 864e5)) }));
  const tulos = { haettu: nyt.toISOString(), viikot: [] };
  for (const v of viikot) {
    const p = { start: v.alku, end: v.loppu };
    const vk = { ...v };
    vk.yhteensa = await api("/stats/total", p);
    vk.sivut = await api("/stats/hits", { ...p, limit: 20, daily: true });
    for (const osio of ["toprefs", "browsers", "systems", "sizes", "locations", "languages", "campaigns"]) {
      try { vk[osio] = await api(`/stats/${osio}`, { ...p, limit: 15 }); } catch (e) { vk[osio] = { virhe: e.message }; }
    }
    tulos.viikot.push(vk);
  }
  const t = tulos.viikot[0].yhteensa;
  console.log(`Viikko ${viikot[0].alku}–${viikot[0].loppu}: ${t.total ?? "?"} sivulatausta, ${t.total_utc ?? ""}`);
  console.log("=== KAVIJAT-ALKU ===");
  console.log(zlib.gzipSync(JSON.stringify(tulos)).toString("base64").match(/.{1,100}/g).join("\n"));
  console.log("=== KAVIJAT-LOPPU ===");
})().catch((e) => { console.error(e.message); process.exit(1); });
