// Koeajo: hakeeko GitHub Actions koulujen kalenterisyötteet onnistuneesti?
// Lukee pelaajat.json-tiedoston joukkueet, hakee jokaisen syötteen kerran ja
// kirjoittaa yhteenvedon. Ei tallenna mitään repoon.
//
// Ajo: node tyokalut/koeajo.js
// GitHub Actionsissa yhteenveto näkyy ajon Summary-sivulla.

const fs = require("fs");
const path = require("path");

const UA = "suomi-ncaa-kalenteri/0.1 (+https://github.com/jiistude/suomi-ncaa)";
const AIKARAJA_MS = 20000;

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "pelaajat.json"), "utf8"));
const joukkueet = data.joukkueet.filter((j) => j.syote);

async function hae(url) {
  const ohjain = new AbortController();
  const ajastin = setTimeout(() => ohjain.abort(), AIKARAJA_MS);
  const alku = Date.now();
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/calendar, */*" },
      redirect: "follow",
      signal: ohjain.signal,
    });
    const teksti = await r.text();
    return { status: r.status, tyyppi: r.headers.get("content-type") || "", teksti, ms: Date.now() - alku };
  } catch (e) {
    return { status: 0, tyyppi: "", teksti: "", ms: Date.now() - alku, virhe: e.name === "AbortError" ? "aikaraja" : e.message };
  } finally {
    clearTimeout(ajastin);
  }
}

function arvioi(v) {
  const t = v.teksti;
  const onIcs = t.includes("BEGIN:VCALENDAR");
  const kalenteri = (t.match(/X-WR-CALNAME:([^\r\n]*)/) || [, ""])[1].trim();
  const otteluita = (t.match(/BEGIN:VEVENT/g) || []).length;
  const tuloksia = (t.match(/DESCRIPTION:[^\r\n]*?\\n[WLT] \d{2,3}-\d{2,3}/g) || []).length;
  const esto = !onIcs && /cloudflare|captcha|access denied|attention required/i.test(t);
  let tila;
  if (v.virhe) tila = "VIRHE";
  else if (v.status === 200 && onIcs && otteluita > 0) tila = "OK";
  else if (esto || v.status === 403 || v.status === 429) tila = "ESTETTY";
  else tila = "OUTO";
  return { tila, kalenteri, otteluita, tuloksia };
}

(async () => {
  const rivit = [];
  // Peräkkäin ja pienellä tauolla, ettei yhtäkään palvelinta kuormiteta.
  for (const j of joukkueet) {
    const v = await hae(j.syote);
    const a = arvioi(v);
    rivit.push({ ...j, ...v, ...a });
    console.log(`${a.tila.padEnd(8)} ${j.avain.padEnd(22)} HTTP ${v.status} ${v.ms} ms  ${a.otteluita} ottelua, ${a.tuloksia} tulosta ${v.virhe || ""}`);
    await new Promise((r) => setTimeout(r, 500));
  }

  const ok = rivit.filter((r) => r.tila === "OK").length;
  let md = `## Koeajo: kalenterisyötteet\n\n**${ok}/${rivit.length} syötettä toimii.**\n\n`;
  md += "| Tila | Joukkue | HTTP | Kalenterin nimi | Otteluita | Tuloksia | Aika |\n|---|---|---|---|---|---|---|\n";
  for (const r of rivit) {
    md += `| ${r.tila} | ${r.koulu} (${r.sarja}) | ${r.status}${r.virhe ? " " + r.virhe : ""} | ${r.kalenteri.replace(/\|/g, "/")} | ${r.otteluita} | ${r.tuloksia} | ${r.ms} ms |\n`;
  }
  const ilman = data.joukkueet.filter((j) => !j.syote).map((j) => `${j.koulu} (${j.sarja})`);
  md += `\nIlman syötettä (ei testattu): ${ilman.join(", ")}\n`;

  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  else console.log("\n" + md);

  // Ajo ei epäonnistu, vaikka osa syötteistä ei toimisi: tulos luetaan yhteenvedosta.
})();
