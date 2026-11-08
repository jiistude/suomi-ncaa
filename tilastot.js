// Suomalaisten tilastorivit pelattujen otteluiden pöytäkirjoista.
//
// Jokainen pöytäkirja haetaan vain kerran: tulos tallennetaan tiedostoon
// docs/tilastot.json, eikä samaa ottelua haeta uudelleen. Jos pöytäkirjaa ei
// saada (verkkovirhe tai pöytäkirja ei vielä valmis), yritetään seuraavalla ajolla.
//
// Lähteet (osapuolen kenttä "tilastolahde"):
//   sidearm    koulun pöytäkirjasivu (HTML-taulukko)
//   wmt        wmt.games-palvelun JSON (Northwestern ym.) tai koulun stats-palvelun XML (UCLA ym.)
//   pdf        PDF-pöytäkirja (Arkansas); vaatii pdftotext-ohjelman (poppler-utils)

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, " ").trim();
const html2teksti = (s) => String(s).replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();
const pari = (s) => { const m = String(s).match(/(\d+)\s*-\s*(\d+)/); return m ? [+m[1], +m[2]] : null; };
const luku = (s) => { const n = parseInt(String(s), 10); return Number.isFinite(n) ? n : null; };
const minuutit = (s) => { const m = String(s).match(/^(\d+)(?::(\d+))?/); return m ? Math.round(+m[1] + (m[2] ? +m[2] / 60 : 0)) : null; };

// Onko rivin nimi tämä pelaaja? Hyväksyy "Sukunimi, Etunimi", "Etunimi Sukunimi" ja "SUKUNIMI,E".
function onPelaaja(teksti, pelaaja) {
  const osat = norm(pelaaja.nimi).split(" ");
  const etu = osat[0], suku = osat[osat.length - 1];
  const t = " " + norm(teksti) + " ";
  return t.includes(" " + suku + " ") && (t.includes(" " + etu + " ") || t.includes(" " + etu[0] + " "));
}

// --- SIDEARM: HTML-pöytäkirja ------------------------------------------------

function sidearm(html, pelaajat) {
  const taulut = html.match(/<table[\s\S]*?<\/table>/g) || [];
  const tulos = {};
  let pelaajaTauluja = 0;
  for (const taulu of taulut) {
    const rivit = taulu.match(/<tr[\s\S]*?<\/tr>/g) || [];
    if (!rivit.length) continue;
    const solut = (r) => (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || []).map(html2teksti);
    const otsikko = solut(rivit[0]).map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, ""));
    // Vain pelaajataulukot (ei pelikuvausta): otsikossa minuutit ja pisteet.
    if (!otsikko.includes("min") || !otsikko.some((x) => x === "pts" || x === "tp")) continue;
    pelaajaTauluja++;
    const sarake = (...nimet) => otsikko.findIndex((x) => nimet.includes(x));
    const s = { min: sarake("min"), fg: sarake("fg", "fgmfga", "fgfga"), kolme: sarake("3pt", "3fg", "3ptfga", "3fgfga"),
      ft: sarake("ft", "ftmfta", "ftfta"), reb: sarake("reb", "tot", "treb"), a: sarake("a", "ast"), to: sarake("to"),
      blk: sarake("blk"), stl: sarake("stl"), pts: sarake("pts", "tp") };
    for (const r of rivit.slice(1)) {
      const c = solut(r);
      if (c.length !== otsikko.length) continue;
      for (const p of pelaajat) {
        if (tulos[p.id] || !onPelaaja(c.slice(0, 3).join(" "), p)) continue;
        tulos[p.id] = {
          min: minuutit(c[s.min]), p: luku(c[s.pts]), lp: luku(c[s.reb]), s: luku(c[s.a]),
          r: luku(c[s.stl]), t: luku(c[s.blk]), m: luku(c[s.to]),
          kh: pari(c[s.fg]), kolme: pari(c[s.kolme]), vh: pari(c[s.ft]),
        };
      }
    }
  }
  return pelaajaTauluja ? tulos : null; // null = pöytäkirja ei vielä valmis / rakenne muuttunut
}

// --- WMT: StatCrew-XML (stats.<koulu>/api/v1/game/xml/<id>) --------------------

function wmtXml(xml, pelaajat) {
  if (!/<bbgame/.test(xml)) return null;
  const tulos = {};
  for (const m of xml.matchAll(/<player\b([^>]*)>([\s\S]*?)<\/player>/g)) {
    const nimi = (m[1].match(/\bname="([^"]*)"/) || [])[1] || "";
    const st = (m[2].match(/<stats\b([^>]*)\/?>/) || [])[1];
    if (!st) continue;
    const a = (k) => luku((st.match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1]);
    for (const p of pelaajat) {
      if (tulos[p.id] || !onPelaaja(nimi.replace(",", " "), p)) continue;
      tulos[p.id] = { min: a("min"), p: a("tp"), lp: a("treb"), s: a("ast"), r: a("stl"), t: a("blk"), m: a("to"),
        kh: [a("fgm"), a("fga")], kolme: [a("fgm3"), a("fga3")], vh: [a("ftm"), a("fta")] };
    }
  }
  return tulos;
}

// --- WMT: wmt.games JSON (pakattu) --------------------------------------------

function wmtGames(teksti, pelaajat) {
  let data = JSON.parse(teksti);
  if (data && data.__gz) data = JSON.parse(zlib.gunzipSync(Buffer.from(data.__gz, "base64")).toString("utf8"));
  const tulos = {};
  let rivejaLoytyi = false;
  const kay = (x) => {
    if (Array.isArray(x)) {
      const nimi = x.find((c) => c && c.key === "name");
      if (nimi && x.some((c) => c && c.key === "sPoints")) {
        rivejaLoytyi = true;
        const v = (k) => (x.find((c) => c && c.key === k) || {}).value;
        for (const p of pelaajat) {
          if (tulos[p.id] || !onPelaaja(nimi.value, p)) continue;
          tulos[p.id] = { min: minuutit(v("sMinutesPlayed")), p: luku(v("sPoints")), lp: luku(v("sTotalRebounds")),
            s: luku(v("sAssists")), r: luku(v("sSteals")), t: luku(v("sBlockedShots")), m: luku(v("sTurnovers")),
            kh: pari(v("sFieldGoals")), kolme: pari(v("sThreePointFieldGoals")), vh: pari(v("sFreeThrows")) };
        }
      }
      x.forEach(kay);
    } else if (x && typeof x === "object") Object.values(x).forEach(kay);
  };
  kay(data);
  return rivejaLoytyi ? tulos : null;
}

// --- PDF (StatCrew-pöytäkirja) --------------------------------------------------

let pdfNaytetty = false;
function pdf(puskuri, pelaajat) {
  const tmp = path.join(os.tmpdir(), "poytakirja.pdf");
  fs.writeFileSync(tmp, puskuri);
  let teksti;
  try { teksti = execFileSync("pdftotext", ["-layout", tmp, "-"], { encoding: "utf8" }); }
  catch (e) { throw new Error("pdftotext puuttuu tai epäonnistui"); }
  if (process.env.PDF_NAYTE && !pdfNaytetty) {
    pdfNaytetty = true;
    console.log("=== PDF-NÄYTE-ALKU ===\n" + teksti.split("\n").slice(0, 60).join("\n") + "\n=== PDF-NÄYTE-LOPPU ===");
  }
  return pdfTekstista(teksti, pelaajat);
}

// Arkansasin PDF-pöytäkirja (pdftotext -layout). Pelaajarivi:
//   "3 Miikka Muurinen   F 17:44 3-9 0-2 4-5  2 2 4  4 7  10 2 1 2  0 0  18"
//   = Min, FG M-A, 3P M-A, FT M-A, OR DR TOT, PF FD, TP AS TO ST, BS BA, +/-
// Pitkillä nimillä rivi katkeaa FT-sarakkeen jälkeen, jolloin loput luvut ovat seuraavalla rivillä.
function pdfTekstista(teksti, pelaajat) {
  const rivit = teksti.split("\n");
  const yhdistetyt = [];
  for (let i = 0; i < rivit.length; i++) {
    let r = rivit[i];
    if (/\d{1,2}:\d{2}\s+\d+-\d+\s+\d+-\d+\s+\d+-\d+\s*$/.test(r) && i + 1 < rivit.length) r += " " + rivit[++i];
    yhdistetyt.push(r);
  }
  const re = /(\d{1,2}):(\d{2})\s+(\d+)-(\d+)\s+(\d+)-(\d+)\s+(\d+)-(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/;
  const tulos = {};
  let rivejaLoytyi = false;
  for (const r of yhdistetyt) {
    const m = r.match(re);
    if (!m) continue;
    rivejaLoytyi = true;
    const nimiosa = r.slice(0, m.index);
    const n = m.slice(1).map(Number);
    for (const p of pelaajat) {
      if (tulos[p.id] || !onPelaaja(nimiosa, p)) continue;
      tulos[p.id] = { min: Math.round(n[0] + n[1] / 60), kh: [n[2], n[3]], kolme: [n[4], n[5]], vh: [n[6], n[7]],
        lp: n[10], p: n[13], s: n[14], m: n[15], r: n[16], t: n[17] };
    }
  }
  return rivejaLoytyi ? tulos : null;
}

// --- Pääfunktio ------------------------------------------------------------------

async function haeTilastot({ ottelut, pelaajat, hae, haePuskuri, tauko, tiedosto, nyt }) {
  let valimuisti = {};
  try { valimuisti = JSON.parse(fs.readFileSync(tiedosto, "utf8")); } catch {}
  const jPelaajat = {};
  for (const p of pelaajat) (jPelaajat[p.joukkue] = jPelaajat[p.joukkue] || []).push(p);
  let haettu = 0, uusia = 0;
  const virheet = [];

  for (const o of ottelut) {
    for (const os_ of o.osapuolet) {
      if (!os_.tulos || !os_.tilastolahde) continue;
      const omat = jPelaajat[os_.joukkue] || [];
      const avain = (p) => `${o.id}|${p.id}`;
      // Derbyssä toisen joukkueen pöytäkirja käy myös: haetaan vain puuttuvat.
      const puuttuvat = o.osapuolet.flatMap((x) => jPelaajat[x.joukkue] || []).filter((p) => !valimuisti[avain(p)]);
      if (!puuttuvat.length || !omat.some((p) => !valimuisti[avain(p)])) continue;
      const l = os_.tilastolahde;
      try {
        let tulos = null;
        if (l.tyyppi === "sidearm") tulos = sidearm(await hae(l.url, "text/html"), puuttuvat);
        else if (l.tyyppi === "pdf") tulos = pdf(await haePuskuri(l.url), puuttuvat);
        else if (l.tyyppi === "wmt") {
          if (l.games) tulos = wmtGames(await hae(`https://wmt.games/proxy-api/games/${l.games}?view=full`, "application/json"), puuttuvat);
          if (!tulos && l.xml) tulos = wmtXml(await hae(l.xml, "application/xml"), puuttuvat);
        }
        haettu++;
        if (!tulos) continue; // pöytäkirja ei vielä valmis
        for (const p of puuttuvat) {
          // Pelaaja, jota ei löydy valmiista pöytäkirjasta, ei pelannut.
          valimuisti[avain(p)] = tulos[p.id] || { eiPelannut: true };
          uusia++;
        }
      } catch (e) {
        virheet.push(`${os_.joukkue} ${o.alku.slice(0, 10)}: ${e.message}`);
      }
      await tauko(400);
    }
  }
  fs.writeFileSync(tiedosto, JSON.stringify(valimuisti, null, 1));
  // Liitä otteluihin.
  for (const o of ottelut) {
    const t = {};
    for (const x of o.osapuolet) for (const p of jPelaajat[x.joukkue] || []) if (valimuisti[`${o.id}|${p.id}`]) t[p.id] = valimuisti[`${o.id}|${p.id}`];
    if (Object.keys(t).length) o.tilastot = t;
  }
  return { haettu, uusia, virheet };
}

module.exports = { haeTilastot, sidearm, wmtXml, wmtGames, pdf, pdfTekstista };
