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

console.log("\n=== SUOMALAISET VASTAKKAIN ===");
for (const o of d.ottelut.filter((x) => x.osapuolet.length > 1)) console.log(`${aika(o.alku)} | ${o.joukkueet.join(" vs ")}`);

// Pakattu data lokiin, jotta sivun voi esikatsella muualla.
const zlib = require("zlib");
console.log("\n=== DATA-BASE64-ALKU ===");
console.log(zlib.gzipSync(fs.readFileSync(path.join(__dirname, "..", "docs", "ottelut.json"))).toString("base64"));
console.log("=== DATA-BASE64-LOPPU ===");
