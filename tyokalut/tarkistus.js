// Tarkistus: tulostaa docs/ottelut.json-tiedostosta yhteenvedon lokiin.
// Ajetaan pull requestissa haun jälkeen. Ei muuta mitään.
const fs = require("fs");
const path = require("path");
const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "ottelut.json"), "utf8"));
const VY = "Europe/Helsinki";
const aika = (s) => new Intl.DateTimeFormat("fi-FI", { timeZone: VY, weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(s));
const nyt = Date.now();

console.log("=== JOUKKUEET ===");
for (const j of d.joukkueet) {
  const o = d.ottelut.filter((x) => x.joukkueet.includes(j.avain));
  const os = o.map((x) => x.osapuolet.find((p) => p.joukkue === j.avain));
  const tba = o.filter((x) => x.tba).length;
  const tyhjat = os.filter((p) => !p.vastustaja || p.vastustaja.length < 3).length;
  const pitkat = os.filter((p) => p.vastustaja.length > 40).map((p) => p.vastustaja);
  const pelattu = os.filter((p) => p.tulos).length;
  const menneetIlman = o.filter((x, i) => !os[i].tulos && new Date(x.alku).getTime() < nyt - 6 * 3600e3).length;
  const pk = os.filter((p) => p.tulos && p.linkkiTyyppi === "poytakirja").length;
  console.log(`${j.avain.padEnd(22)} ${String(o.length).padStart(3)} ott, ${pelattu} pelattu, pöytäkirja ${pk}/${pelattu}, saldo ${j.saldo.v}-${j.saldo.t}, tba ${tba}, tyhjiä vast ${tyhjat}, menneitä ilman tulosta ${menneetIlman}${pitkat.length ? " PITKÄ: " + pitkat[0] : ""}`);
}

console.log("\n=== PELATUT (kaikki) ===");
for (const o of d.ottelut.filter((x) => x.osapuolet.some((p) => p.tulos))) {
  console.log(`${aika(o.alku)} | ${o.osapuolet.map((p) => `${p.joukkue} ${p.paikka === "vieras" ? "@" : "vs"} ${p.vastustaja} ${p.tulos ? (p.tulos.voitto ? "V" : "T") + " " + p.tulos.oma + "-" + p.tulos.vast : "-"} ${p.linkkiTyyppi} ${p.linkki}`).join(" || ")}`);
}

console.log("\n=== TULEVAT 7 PV ===");
for (const o of d.ottelut.filter((x) => !x.osapuolet.some((p) => p.tulos) && new Date(x.alku).getTime() > nyt && new Date(x.alku).getTime() < nyt + 7 * 864e5)) {
  console.log(`${aika(o.alku)}${o.tba ? " (TBA)" : ""} | ${o.osapuolet.map((p) => `${p.joukkue} ${p.paikka === "vieras" ? "@" : p.paikka === "neutraali" ? "N" : "vs"} ${p.vastustaja}${p.striimi ? " [striimi]" : ""}`).join(" || ")}`);
}

console.log("\n=== TILASTORIVIT ===");
const nimi = Object.fromEntries(d.pelaajat.map((p) => [p.id, p.nimi]));
let rivit = 0, puuttuu = [];
for (const o of d.ottelut.filter((x) => x.osapuolet.some((p) => p.tulos))) {
  const t = o.tilastot || {};
  for (const p of d.pelaajat.filter((p) => o.joukkueet.includes(p.joukkue))) {
    const s = t[p.id];
    if (!s) { puuttuu.push(`${o.alku.slice(0, 10)} ${p.nimi}`); continue; }
    rivit++;
    console.log(`${o.alku.slice(0, 10)} ${nimi[p.id].padEnd(20)} ${s.eiPelannut ? "ei pelannut" : `${s.min} min, ${s.p} p, ${s.lp} lp, ${s.s} s, ${s.r} r, ${s.t} t, ${s.m} m, kh ${s.kh}, 3p ${s.kolme}, vh ${s.vh}, hl ${s.hl}, pl ${s.pl}, vi ${s.vi}, ver ${s.ver}`}`);
  }
}
console.log(`Tilastorivejä ${rivit}, puuttuu ${puuttuu.length}: ${puuttuu.join("; ")}`);
{
  const kaikki = d.ottelut.flatMap((o) => Object.values(o.tilastot || {})).filter((s) => !s.eiPelannut);
  for (const k of ["hl", "pl", "vi"]) console.log(`Kenttä ${k}: ${kaikki.filter((s) => s[k] != null).length}/${kaikki.length}`);
  for (const j of d.joukkueet) {
    const r = d.ottelut.filter((o) => o.joukkueet.includes(j.avain)).flatMap((o) => d.pelaajat.filter((p) => p.joukkue === j.avain).map((p) => (o.tilastot || {})[p.id])).filter((s) => s && !s.eiPelannut);
    const puute = r.filter((s) => s.hl == null || s.pl == null || s.vi == null).length;
    if (puute) console.log(`  OREB/DREB/PF puuttuu: ${j.avain} ${puute}/${r.length}`);
  }
}

console.log("\n=== SUOMALAISET VASTAKKAIN ===");
for (const o of d.ottelut.filter((x) => x.osapuolet.length > 1)) console.log(`${aika(o.alku)} | ${o.joukkueet.join(" vs ")}`);

// Pakattu data lokiin, jotta sivun voi esikatsella muualla.
const zlib = require("zlib");
console.log("\n=== DATA-BASE64-ALKU ===");
console.log(zlib.gzipSync(fs.readFileSync(path.join(__dirname, "..", "docs", "ottelut.json"))).toString("base64"));
console.log("=== DATA-BASE64-LOPPU ===");
