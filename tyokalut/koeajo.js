// Koeajo: toimivatko joukkueiden otteluohjelmalähteet GitHub Actionsista?
// Lukee pelaajat.json-tiedoston joukkueet, hakee jokaisen lähteen kerran ja
// kirjoittaa yhteenvedon. Ei tallenna mitään repoon.
//
// Lähdetyypit (kenttä "tyyppi"):
//   sidearm-ics   koulun ICS-syöte, tulos DESCRIPTION-kentässä ("W 76-61")
//   wmt-api       koulun website-api (JSON), tulos kentässä schedule_event_result
//   wmt-ics+sivu  WMT-kalenterisyöte (vain tulevat) + koulun otteluohjelmasivu (tulokset)
//
// Ajo: node tyokalut/koeajo.js

const fs = require("fs");
const path = require("path");

const UA = "suomi-ncaa-kalenteri/0.1 (+https://github.com/jiistude/suomi-ncaa)";
const AIKARAJA_MS = 20000;

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "pelaajat.json"), "utf8"));

async function hae(url, accept) {
  const ohjain = new AbortController();
  const ajastin = setTimeout(() => ohjain.abort(), AIKARAJA_MS);
  const alku = Date.now();
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, redirect: "follow", signal: ohjain.signal });
    return { status: r.status, teksti: await r.text(), ms: Date.now() - alku };
  } catch (e) {
    return { status: 0, teksti: "", ms: Date.now() - alku, virhe: e.name === "AbortError" ? "aikaraja" : e.message };
  } finally {
    clearTimeout(ajastin);
  }
}

const estetty = (v) => v.status === 403 || v.status === 429 || /cloudflare|captcha|access denied|attention required/i.test(v.teksti.slice(0, 3000));

function tila(v, otteluita) {
  if (v.virhe) return "VIRHE";
  if (v.status === 200 && otteluita > 0) return "OK";
  if (estetty(v)) return "ESTETTY";
  return "OUTO";
}

async function sidearmIcs(j) {
  const v = await hae(j.syote, "text/calendar, */*");
  const otteluita = (v.teksti.match(/BEGIN:VEVENT/g) || []).length;
  const tuloksia = (v.teksti.match(/DESCRIPTION:[^\r\n]*?\\n[WLT] \d{2,3}-\d{2,3}/g) || []).length;
  return { ...v, otteluita, tuloksia, tila: tila(v, otteluita) };
}

async function wmtApi(j) {
  // schedule_id vaihtuu kausittain, joten se haetaan lajin nimellä.
  const s = await hae(`${j.sivusto}/website-api/sports?filter%5Bslug%5D=${j.laji}`, "application/json");
  let sid = null;
  try { sid = JSON.parse(s.teksti).data[0].schedule_id; } catch {}
  if (!sid) return { ...s, otteluita: 0, tuloksia: 0, tila: s.virhe ? "VIRHE" : estetty(s) ? "ESTETTY" : "OUTO", huom: "schedule_id ei löytynyt" };
  const url = `${j.sivusto}/website-api/schedule-events?filter%5Bschedule_id%5D=${sid}&per_page=100&sort=datetime&page=1&include=opponent,scheduleEventResult`;
  const v = await hae(url, "application/json");
  let rivit = [];
  try { rivit = JSON.parse(v.teksti).data || []; } catch {}
  const tuloksia = rivit.filter((e) => e.schedule_event_result && e.schedule_event_result.result).length;
  return { ...v, ms: v.ms + s.ms, otteluita: rivit.length, tuloksia, tila: tila(v, rivit.length), huom: `schedule_id ${sid}` };
}

async function wmtIcsSivu(j) {
  const v = await hae(j.syote, "text/calendar, */*");
  const otteluita = (v.teksti.match(/BEGIN:VEVENT/g) || []).length;
  await new Promise((r) => setTimeout(r, 500));
  const s = await hae(j.tulossivu, "text/html");
  const teksti = s.teksti.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const tuloksia = (teksti.match(/\b[WL], \d{2,3}-\d{2,3}\b/g) || []).length;
  const t = tila(v, otteluita) === "OK" && s.status === 200 && tuloksia > 0 ? "OK" : tila(v, otteluita) === "OK" ? "OSIN" : tila(v, otteluita);
  return { ...v, ms: v.ms + s.ms, otteluita, tuloksia, tila: t, huom: `tulossivu HTTP ${s.status}` };
}

const kasittelija = { "sidearm-ics": sidearmIcs, "wmt-api": wmtApi, "wmt-ics+sivu": wmtIcsSivu };

(async () => {
  const rivit = [];
  // Peräkkäin ja pienellä tauolla, ettei yhtäkään palvelinta kuormiteta.
  for (const j of data.joukkueet) {
    const f = kasittelija[j.tyyppi];
    if (!f) { rivit.push({ ...j, tila: "EI LÄHDETTÄ", status: "-", otteluita: 0, tuloksia: 0, ms: 0 }); continue; }
    const v = await f(j);
    rivit.push({ ...j, ...v });
    console.log(`${v.tila.padEnd(8)} ${j.avain.padEnd(22)} ${j.tyyppi.padEnd(13)} HTTP ${v.status} ${v.ms} ms  ${v.otteluita} ottelua, ${v.tuloksia} tulosta ${v.virhe || v.huom || ""}`);
    await new Promise((r) => setTimeout(r, 500));
  }

  const ok = rivit.filter((r) => r.tila === "OK").length;
  let md = `## Koeajo: otteluohjelmalähteet\n\n**${ok}/${rivit.length} lähdettä toimii.**\n\n`;
  md += "| Tila | Joukkue | Lähde | HTTP | Otteluita | Tuloksia | Aika | Huom |\n|---|---|---|---|---|---|---|---|\n";
  for (const r of rivit) {
    md += `| ${r.tila} | ${r.koulu} (${r.sarja}) | ${r.tyyppi || "-"} | ${r.status} | ${r.otteluita} | ${r.tuloksia} | ${r.ms} ms | ${r.virhe || r.huom || ""} |\n`;
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  else console.log("\n" + md);
})();
