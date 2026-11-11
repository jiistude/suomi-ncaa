// Kertaluonteinen tarkistus: toimivatko D2-suomalaisten koulujen lähteet samoin kuin D1:ssä
// (SIDEARM-kalenterisyöte, otteluohjelman pöytäkirjalinkit, pöytäkirjan tilastorivi).
const { sidearm } = require("../tilastot");
const UA = "suomi-ncaa-kalenteri/0.1 (+https://github.com/jiistude/suomi-ncaa)";
const tauko = (ms) => new Promise((r) => setTimeout(r, ms));
async function hae(url) {
  const o = new AbortController(); const t = setTimeout(() => o.abort(), 15000);
  try { const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: o.signal }); return { status: r.status, teksti: r.ok ? await r.text() : "" }; }
  catch (e) { return { status: e.message.slice(0, 40), teksti: "" }; } finally { clearTimeout(t); }
}
const KOULUT = [
  { nimi: "Christian Blomfelt", id: "blomfelt", juuri: "https://augustajags.com", laji: "mens-basketball" },
  { nimi: "Henri Mennander", id: "mennander", juuri: "https://broncoathletics.com", laji: "mens-basketball" },
  { nimi: "Kalle Kuhalampi", id: "kuhalampi", juuri: "https://cameronaggies.com", laji: "mens-basketball" },
  { nimi: "Leo Nordberg", id: "nordberg", juuri: "https://lcuchaps.com", laji: "mens-basketball" },
  { nimi: "Eino Montin", id: "montin", juuri: "https://msubsports.com", laji: "mens-basketball" },
  { nimi: "Brunel Madzou", id: "madzou", juuri: "https://scsuowls.com", laji: "mens-basketball" },
  { nimi: "Edit Merivirta", id: "merivirta", juuri: "https://uttylerpatriots.com", laji: "womens-basketball", toinen: { nimi: "Lilli Hakkarainen", id: "hakkarainen" } },
  { nimi: "Monna Julkunen", id: "julkunen", juuri: "https://vstateblazers.com", laji: "womens-basketball" },
];
(async () => {
  for (const k of KOULUT) {
    console.log(`\n## ${k.nimi} – ${k.juuri}`);
    // 1) Kalenterisyöte: etsitään oikea sport_id kalenterin nimestä.
    const halu = k.laji.startsWith("mens") ? /^(?!.*women).*men'?s basketball/i : /women'?s basketball/i;
    let ics = null;
    for (let id = 1; id <= 30 && !ics; id++) {
      const r = await hae(`${k.juuri}/calendar.ashx/calendar.ics?sport_id=${id}`);
      const nimi = (r.teksti.match(/X-WR-CALNAME:(.*)/) || [])[1] || "";
      if (r.status === 200 && halu.test(nimi)) ics = { id, nimi: nimi.trim(), tapahtumia: (r.teksti.match(/BEGIN:VEVENT/g) || []).length, tuloksia: (r.teksti.match(/DESCRIPTION:[^\r\n]*\\n[WLT] \d+-\d+/g) || []).length };
      if (id === 1 && r.status !== 200) { console.log(`  Kalenterisyöte: HTTP ${r.status}`); break; }
      await tauko(150);
    }
    console.log(ics ? `  Kalenterisyöte OK: sport_id=${ics.id} "${ics.nimi}", ${ics.tapahtumia} tapahtumaa, tuloksia ${ics.tuloksia}` : "  Kalenterisyötettä ei löytynyt");
    // 2) Otteluohjelman pöytäkirjalinkit.
    const s = await hae(`${k.juuri}/sports/${k.laji}/schedule`);
    const linkit = [...new Set((s.teksti.match(new RegExp(`/sports/${k.laji}/stats/[^"'\\s]+/boxscore/\\d+`, "g")) || []))];
    console.log(`  Otteluohjelma: HTTP ${s.status}, pöytäkirjalinkkejä ${linkit.length}${linkit[0] ? " (esim. " + linkit[0] + ")" : ""}`);
    // 3) Pöytäkirjan tilastorivi viimeisimmästä pelistä.
    const pelaajat = [{ id: k.id, nimi: k.nimi }, ...(k.toinen ? [k.toinen] : [])];
    for (const l of linkit.slice(-2)) {
      const b = await hae(k.juuri + l);
      const t = b.teksti ? sidearm(b.teksti, pelaajat) : {};
      console.log(`  Pöytäkirja ${l.split("/stats/")[1]}: HTTP ${b.status} → ${pelaajat.map((p) => `${p.nimi}: ${t[p.id] ? JSON.stringify(t[p.id]) : "ei riviä"}`).join(" | ")}`);
      await tauko(300);
    }
  }
})();
