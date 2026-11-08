// Suomalaiset NCAA:ssa – haku ja sivun rakennus.
//
// Lukee pelaajat.json-tiedoston, hakee jokaisen joukkueen otteluohjelman koulun
// omasta lähteestä, muuttaa ne yhteen muotoon ja kirjoittaa docs/-kansioon
//   docs/index.html    sivu
//   docs/ottelut.json  sama data koneluettavana
//
// Ei ulkoisia riippuvuuksia (Node 20).
//
// Ympäristömuuttujat (vain testaukseen):
//   RAAKA_TALLENNA=kansio  tallentaa haetut vastaukset kansioon
//   RAAKA_LUE=kansio       lukee vastaukset kansiosta eikä hae verkosta
//   NYT=2026-11-09T12:00Z  käyttää tätä hetkeä "nyt"-aikana

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const JUURI = __dirname;
const DOCS = path.join(JUURI, "docs");
const UA = "suomi-ncaa-kalenteri/0.1 (+https://github.com/jiistude/suomi-ncaa)";
const AIKARAJA_MS = 20000;
const NYT = process.env.NYT ? new Date(process.env.NYT) : new Date();

const asetukset = JSON.parse(fs.readFileSync(path.join(JUURI, "pelaajat.json"), "utf8"));
const KAUDEN_ALKU = new Date(asetukset.kauden_alku + "T00:00:00Z");

// ---------------------------------------------------------------------------
// Haku

const tauko = (ms) => new Promise((r) => setTimeout(r, ms));
const tiedostonimi = (url) => crypto.createHash("sha1").update(url).digest("hex").slice(0, 16) + ".txt";

async function hae(url, accept) {
  if (process.env.RAAKA_LUE) {
    const f = path.join(process.env.RAAKA_LUE, tiedostonimi(url));
    if (!fs.existsSync(f)) throw new Error("ei välimuistissa: " + url);
    return fs.readFileSync(f, "utf8");
  }
  const ohjain = new AbortController();
  const ajastin = setTimeout(() => ohjain.abort(), AIKARAJA_MS);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, redirect: "follow", signal: ohjain.signal });
    const teksti = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (process.env.RAAKA_TALLENNA) {
      fs.mkdirSync(process.env.RAAKA_TALLENNA, { recursive: true });
      fs.writeFileSync(path.join(process.env.RAAKA_TALLENNA, tiedostonimi(url)), teksti);
    }
    return teksti;
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "aikaraja ylittyi" : e.message);
  } finally {
    clearTimeout(ajastin);
  }
}

// ---------------------------------------------------------------------------
// Aikavyöhykkeet: paikallinen aika -> UTC

function vyohykkeenSiirtyma(ts, vyohyke) {
  const osat = new Intl.DateTimeFormat("en-US", {
    timeZone: vyohyke, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ts));
  const g = (t) => Number(osat.find((x) => x.type === t).value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - ts;
}

function paikallinenUtc(v, kk, pv, h, min, vyohyke) {
  const arvaus = Date.UTC(v, kk - 1, pv, h, min);
  let t = arvaus - vyohykkeenSiirtyma(arvaus, vyohyke);
  const s2 = vyohykkeenSiirtyma(t, vyohyke);
  if (arvaus - s2 !== t) t = arvaus - s2;
  return new Date(t);
}

// ---------------------------------------------------------------------------
// Apufunktiot

const siisti = (s) => String(s || "").replace(/\s+/g, " ").trim();
// Poistaa rankingin (#18), harjoitusmerkinnät ja turhat välit vastustajan nimestä.
const vastustajanNimi = (s) => siisti(String(s).replace(/^#\d+(\/\d+)?\s+/, "").replace(/\((exh\.?|exhibition)\)/i, ""));
const onHarjoitus = (s) => /\b(exh\.?|exhibition|scrimmage|red\s*\/\s*black|blue\s*\/\s*white|open practice)\b/i.test(s);

function tulos(wl, a, b) {
  // Lähteet antavat pisteet joko omat ensin tai voittajan ensin. Voitossa omat
  // pisteet ovat aina suuremmat, tappiossa pienemmät, joten järjestyksellä ei ole väliä.
  a = Number(a); b = Number(b);
  if (!wl || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const voitto = /^w/i.test(wl);
  return { voitto, oma: voitto ? Math.max(a, b) : Math.min(a, b), vast: voitto ? Math.min(a, b) : Math.max(a, b) };
}

// ---------------------------------------------------------------------------
// ICS-jäsennin (riittää koulujen syötteille)

function jasennaIcs(teksti) {
  const rivit = teksti.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const tapahtumat = [];
  let t = null;
  for (const rivi of rivit) {
    if (rivi === "BEGIN:VEVENT") t = {};
    else if (rivi === "END:VEVENT") { if (t) tapahtumat.push(t); t = null; }
    else if (t) {
      const i = rivi.indexOf(":");
      if (i < 0) continue;
      const [nimi, ...param] = rivi.slice(0, i).split(";");
      t[nimi] = { arvo: rivi.slice(i + 1), param: Object.fromEntries(param.map((p) => p.split("="))) };
    }
  }
  return tapahtumat;
}

const icsTeksti = (s) => String(s || "").replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

function icsAika(kentta, oletusVyohyke) {
  if (!kentta) return null;
  const m = kentta.arvo.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
  if (!m) return null;
  const [, v, kk, pv, h, min, , z] = m;
  if (h === undefined) return { alku: paikallinenUtc(+v, +kk, +pv, 12, 0, oletusVyohyke), tba: true };
  if (z) return { alku: new Date(Date.UTC(+v, kk - 1, +pv, +h, +min)), tba: false };
  return { alku: paikallinenUtc(+v, +kk, +pv, +h, +min, kentta.param.TZID || oletusVyohyke), tba: false };
}

// ---------------------------------------------------------------------------
// Lähteet. Jokainen palauttaa listan otteluita yhteisessä muodossa:
//   { alku: Date, tba, vastustaja, paikka: "koti"|"vieras"|"neutraali", sijainti,
//     tulos: {voitto, oma, vast} | null, striimi, linkki, harjoitus }

async function sidearmIcs(j) {
  const teksti = await hae(j.syote, "text/calendar, */*");
  if (!teksti.includes("BEGIN:VCALENDAR")) throw new Error("vastaus ei ole kalenteri");
  return jasennaIcs(teksti).map((t) => {
    const otsikko = icsTeksti(t.SUMMARY && t.SUMMARY.arvo).replace(/^\[[A-Z]\]\s*/, "");
    const kuvaus = icsTeksti(t.DESCRIPTION && t.DESCRIPTION.arvo);
    const aika = icsAika(t.DTSTART, "America/New_York");
    // "Davidson College Men's Basketball vs Mercer" -> vs / Mercer
    const loppu = otsikko.replace(/^.*?Basketball(\s*\([MW]\))?\s*/i, "");
    const m = loppu.match(/^(vs\.?|at)\s+(.+)$/i);
    const tm = kuvaus.match(/(?:^|\n)\s*([WLT])\s+(\d{1,3})\s*-\s*(\d{1,3})/);
    const striimi = (kuvaus.match(/Streaming Video:\s*(\S+)/i) || [])[1] || null;
    const linkki = t.URL ? t.URL.arvo.replace("&amp;", "&").replace("//admin.", "//") : null;
    return {
      alku: aika && aika.alku, tba: aika ? aika.tba : true,
      // Osa kouluista lisää nimen perään kampanjatekstin: "Incarnate Word - Season Opener | …"
      vastustaja: vastustajanNimi((m ? m[2] : loppu).split(/\s+[-–|]\s+|\s+\|/)[0]),
      paikka: m && /^at$/i.test(m[1]) ? "vieras" : "koti",
      sijainti: siisti(icsTeksti(t.LOCATION && t.LOCATION.arvo)),
      tulos: tm ? tulos(tm[1], tm[2], tm[3]) : null,
      striimi, linkki,
      harjoitus: onHarjoitus(otsikko),
    };
  });
}

async function wmtApi(j) {
  // schedule_id vaihtuu kausittain, joten se haetaan lajin nimellä joka kerta.
  const lajit = JSON.parse(await hae(`${j.sivusto}/website-api/sports?filter%5Bslug%5D=${j.laji}`, "application/json"));
  const sid = lajit.data && lajit.data[0] && lajit.data[0].schedule_id;
  if (!sid) throw new Error("otteluohjelman tunnistetta ei löytynyt");
  await tauko(300);
  const url = `${j.sivusto}/website-api/schedule-events?filter%5Bschedule_id%5D=${sid}&per_page=100&sort=datetime&page=1&include=opponent,scheduleEventResult`;
  const data = JSON.parse(await hae(url, "application/json"));
  return (data.data || []).map((e) => {
    const r = e.schedule_event_result;
    return {
      alku: new Date(e.datetime), tba: Boolean(e.tba) || Boolean(e.is_all_day),
      vastustaja: vastustajanNimi((e.opponent && e.opponent.name) || e.opponent_name),
      paikka: e.neutral_event ? "neutraali" : e.venue_type === "away" ? "vieras" : "koti",
      sijainti: siisti(e.location),
      tulos: r && r.result ? tulos(r.result, r.winning_score, r.losing_score) : null,
      striimi: null,
      linkki: e.box_score_url || `${j.sivusto}/sports/${j.laji}/schedule`,
      harjoitus: Boolean(e.is_exhibition) || onHarjoitus(e.opponent_name),
    };
  });
}

const KUUKAUDET = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

async function wmtSivu(j) {
  // Arkansas: koulun julkinen otteluohjelmasivu. Jokainen ottelu on oma
  // <div class="blocks">-lohkonsa.
  const html = await hae(j.sivu, "text/html");
  const lohkot = html.split(/<div class="blocks">/).slice(1);
  if (!lohkot.length) throw new Error("sivun rakenne on muuttunut (otteluita ei löytynyt)");
  const vuosi1 = Number(asetukset.kausi.slice(0, 4));
  const teksti = (re, s) => { const m = s.match(re); return m ? siisti(m[1].replace(/<[^>]+>/g, " ")) : ""; };
  const ottelut = [];
  for (const l of lohkot) {
    const tyyppi = teksti(/<div class="type[^"]*">([\s\S]*?)<\/div>/, l).toLowerCase();
    const pvm = teksti(/<span class="month">([\s\S]*?)<\/span>/, l);
    const klo = teksti(/<div class="date">[\s\S]*?<span class="time">([\s\S]*?)<\/span>/, l);
    const vast = teksti(/<div class="opponent">\s*<span>([\s\S]*?)<\/span>/, l);
    const tul = teksti(/<div class="results[^"]*">([\s\S]*?)<\/div>/, l);
    const paikka = teksti(/<div class="place">([\s\S]*?)<\/div>/, l);
    const mp = pvm.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s*$/);
    if (!mp || !vast) continue;
    const kk = KUUKAUDET[mp[1].toLowerCase()];
    const vuosi = kk >= 7 ? vuosi1 : vuosi1 + 1;
    const mk = klo.match(/(\d{1,2}):(\d{2})\s*([AP])\.?M/i);
    let h = 12, min = 0, tba = true;
    if (mk) { h = (+mk[1] % 12) + (/p/i.test(mk[3]) ? 12 : 0); min = +mk[2]; tba = false; }
    const mt = tul.match(/([WL]),?\s*(\d{1,3})\s*-\s*(\d{1,3})/);
    ottelut.push({
      alku: paikallinenUtc(vuosi, kk, +mp[2], h, min, j.aikavyohyke || "America/Chicago"), tba,
      vastustaja: vastustajanNimi(vast),
      paikka: tyyppi.includes("neutral") ? "neutraali" : tyyppi.includes("away") ? "vieras" : "koti",
      sijainti: paikka,
      tulos: mt ? tulos(mt[1], mt[2], mt[3]) : null,
      striimi: null, linkki: j.sivu,
      harjoitus: onHarjoitus(vast),
    });
  }
  return ottelut;
}

const LAHTEET = { "sidearm-ics": sidearmIcs, "wmt-api": wmtApi, "wmt-sivu": wmtSivu };

// ---------------------------------------------------------------------------
// Suomalainen vastaan suomalainen: sama ottelu kahdesta lähteestä

const normalisoi = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\buniversity( of)?\b|\bthe\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function vastustajaOnJoukkue(vastustaja, joukkue) {
  const v = normalisoi(vastustaja);
  return joukkue.nimet.some((n) => normalisoi(n) === v);
}

// ---------------------------------------------------------------------------
// Pääohjelma

(async () => {
  const pelaajat = asetukset.pelaajat;
  const joukkueet = asetukset.joukkueet;
  const edellinen = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(DOCS, "ottelut.json"), "utf8")); } catch { return null; }
  })();

  const virheet = [];
  const raaka = [];
  for (const j of joukkueet) {
    const f = LAHTEET[j.tyyppi];
    let lista;
    try {
      if (!f) throw new Error(`tuntematon lähdetyyppi "${j.tyyppi}"`);
      lista = (await f(j)).filter((o) => o.alku && !isNaN(o.alku));
      if (!lista.length) throw new Error("lähde ei palauttanut yhtään ottelua");
      console.log(`OK     ${j.avain.padEnd(22)} ${lista.length} tapahtumaa`);
    } catch (e) {
      virheet.push({ joukkue: j.avain, virhe: e.message });
      console.error(`VIRHE  ${j.avain.padEnd(22)} ${e.message} – käytetään edellisen ajon tietoja`);
      // Jos haku epäonnistuu, sivulla pidetään edellisen onnistuneen ajon ottelut.
      lista = edellinen ? edellinen.ottelut.filter((o) => o.joukkueet.includes(j.avain)).map((o) => {
        const oma = o.osapuolet.find((p) => p.joukkue === j.avain);
        return { ...oma, alku: new Date(o.alku), tba: o.tba, sijainti: o.sijainti, harjoitus: false };
      }) : [];
    }
    for (const o of lista) raaka.push({ ...o, joukkue: j.avain });
    await tauko(500);
  }

  // Kauden alkua edeltävät ja harjoitusottelut pois.
  const kauden = raaka.filter((o) => !o.harjoitus && o.alku >= KAUDEN_ALKU);

  // Yhdistä suomalaisten keskinäiset ottelut yhdeksi (sama päivä, vastustaja on seurattu joukkue).
  const jMap = Object.fromEntries(joukkueet.map((j) => [j.avain, j]));
  const kaytetty = new Set();
  const ottelut = [];
  kauden.sort((a, b) => a.alku - b.alku);
  for (let i = 0; i < kauden.length; i++) {
    if (kaytetty.has(i)) continue;
    const a = kauden[i];
    const ryhma = [a];
    const ja = jMap[a.joukkue];
    for (let k = i + 1; k < kauden.length && kauden[k].alku - a.alku < 12 * 3600e3; k++) {
      const b = kauden[k];
      if (kaytetty.has(k) || b.joukkue === a.joukkue) continue;
      const jb = jMap[b.joukkue];
      if (jb.sarja === ja.sarja && vastustajaOnJoukkue(a.vastustaja, jb) && vastustajaOnJoukkue(b.vastustaja, ja)) {
        ryhma.push(b); kaytetty.add(k);
      }
    }
    // Aika: ensimmäinen lähde, jossa kellonaika on tiedossa.
    const ajallinen = ryhma.find((o) => !o.tba) || a;
    ottelut.push({
      id: crypto.createHash("sha1").update(ryhma.map((o) => o.joukkue + o.alku.toISOString().slice(0, 10)).sort().join("|")).digest("hex").slice(0, 10),
      alku: ajallinen.alku.toISOString(),
      tba: ajallinen.tba,
      sarja: ja.sarja,
      sijainti: ajallinen.sijainti || "",
      joukkueet: ryhma.map((o) => o.joukkue),
      osapuolet: ryhma.map((o) => ({
        joukkue: o.joukkue, vastustaja: o.vastustaja, paikka: o.paikka, tulos: o.tulos,
        striimi: o.striimi, linkki: o.linkki,
      })),
    });
  }

  // Joukkueiden voitto-tappio-saldo.
  const saldo = {};
  for (const o of ottelut) for (const p of o.osapuolet) {
    if (!p.tulos) continue;
    const s = (saldo[p.joukkue] = saldo[p.joukkue] || { v: 0, t: 0 });
    p.tulos.voitto ? s.v++ : s.t++;
  }

  const ulos = {
    paivitetty: NYT.toISOString(),
    kausi: asetukset.kausi,
    virheet,
    joukkueet: joukkueet.map((j) => ({ avain: j.avain, koulu: j.koulu, sarja: j.sarja, saldo: saldo[j.avain] || { v: 0, t: 0 } })),
    pelaajat: pelaajat.map((p) => ({ id: p.id, nimi: p.nimi, sarja: p.sarja, joukkue: p.joukkue, koulu: p.koulu, vuosiluokka: p.vuosiluokka, pelipaikka: p.pelipaikka, kotipaikka: p.kotipaikka, kasvattajaseura: p.kasvattajaseura })),
    ottelut,
  };

  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(path.join(DOCS, "ottelut.json"), JSON.stringify(ulos, null, 1));
  const pohja = fs.readFileSync(path.join(JUURI, "sivu.html"), "utf8");
  const json = JSON.stringify(ulos).replace(/</g, "\\u003c");
  fs.writeFileSync(path.join(DOCS, "index.html"), pohja.replace("/*__DATA__*/null", json));

  const pelattu = ottelut.filter((o) => o.osapuolet.some((p) => p.tulos)).length;
  console.log(`\n${ottelut.length} ottelua (${pelattu} pelattu), ${virheet.length} virhettä.`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    let md = `## Haku\n\n${ottelut.length} ottelua, joista ${pelattu} pelattu. Virheitä ${virheet.length}.\n\n`;
    if (virheet.length) md += virheet.map((v) => `- **${v.joukkue}**: ${v.virhe}`).join("\n") + "\n";
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }
  // Ajo epäonnistuu vain, jos yli kolmasosa lähteistä ei toimi: silloin jokin on pielessä laajemmin.
  if (virheet.length > joukkueet.length / 3) process.exitCode = 1;
})();
