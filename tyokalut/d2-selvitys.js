// Kertaluonteinen selvitys: suomalaiset NCAA Division II -koripallojoukkueissa (M ja N), kausi 2026-27.
// 1) Koululista NCAA:n jäsenhakemistosta (division II), 2) jokaisen koulun miesten ja naisten rosterisivu,
// 3) rosterista haetaan viittaukset Suomeen (kotipaikka/kansalaisuus). Tulos lokiin; ei muuta sivua.
const UA = "Mozilla/5.0 (compatible; suomi-ncaa-selvitys/1.0; +https://ncaa.stude.basketball)";
const KAUSI = "2026-27";
const tauko = (ms) => new Promise((r) => setTimeout(r, ms));

async function hae(url, ms = 15000) {
  const o = new AbortController(); const t = setTimeout(() => o.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/json" }, redirect: "follow", signal: o.signal });
    return { ok: r.ok, status: r.status, url: r.url, teksti: r.ok ? await r.text() : "" };
  } catch (e) { return { ok: false, status: e.name === "AbortError" ? "aikakatkaisu" : e.message.slice(0, 60), teksti: "" }; }
  finally { clearTimeout(t); }
}

async function koulut() {
  const r = await hae("https://web3.ncaa.org/directory/api/directory/memberList?type=12&division=II", 30000);
  if (!r.ok) throw new Error("Jäsenhakemisto ei vastannut: " + r.status);
  const lista = JSON.parse(r.teksti);
  console.log(`Jäsenhakemisto: ${lista.length} riviä. Esimerkkikentät: ${Object.keys(lista[0] || {}).join(", ")}`);
  const url = (x) => x.athleticWebUrl || x.athleticsWebUrl || x.athleticUrl || x.webSiteUrl || "";
  return lista
    .filter((x) => (x.divisionRoman === "II" || Number(x.division) === 2) && !x.deactive)
    .map((x) => ({ nimi: x.nameOfficial || x.name || x.orgName, url: url(x).trim() }))
    .filter((x) => x.url);
}

const POLUT = {
  M: ["/sports/mens-basketball/roster", `/sports/mbkb/${KAUSI}/roster`, "/sports/mbkb/roster", "/sports/m-baskbl/roster", "/roster.aspx?path=mbball"],
  N: ["/sports/womens-basketball/roster", `/sports/wbkb/${KAUSI}/roster`, "/sports/wbkb/roster", "/sports/w-baskbl/roster", "/roster.aspx?path=wbball"],
};
const tekstiksi = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, " ");
const SUOMI = /\bFinland\b|\bSuomi\b|\bFinnish\b|,\s*FIN\b|\(FIN\)|\bFIN\s*\/|\bHelsinki\b|\bEspoo\b|\bTampere\b|\bVantaa\b|\bTurku\b|\bOulu\b|\bJyväskylä\b|\bJyvaskyla\b|\bKuopio\b|\bLahti\b/g;

async function rosteri(koulu, sarja) {
  const juuri = koulu.url.replace(/\/+$/, "").replace(/^http:/, "https:");
  const base = /^https?:\/\//.test(juuri) ? juuri : "https://" + juuri;
  for (const polku of POLUT[sarja]) {
    const r = await hae(base + polku);
    await tauko(200);
    if (!r.ok || r.teksti.length < 3000 || !/roster/i.test(r.teksti)) continue;
    const t = tekstiksi(r.teksti);
    const osumat = [];
    for (const m of t.matchAll(SUOMI)) osumat.push(t.slice(Math.max(0, m.index - 220), m.index + 80));
    return { ok: true, url: r.url, osumat };
  }
  return { ok: false };
}

(async () => {
  const lista = await koulut();
  console.log(`D2-kouluja urheilusivuineen: ${lista.length}`);
  const tulokset = [], epaonnistuneet = { M: [], N: [] };
  let i = 0;
  async function tyontekija() {
    while (i < lista.length) {
      const k = lista[i++];
      for (const sarja of ["M", "N"]) {
        const r = await rosteri(k, sarja);
        if (!r.ok) { epaonnistuneet[sarja].push(k.nimi); continue; }
        if (r.osumat.length) tulokset.push({ koulu: k.nimi, sarja, url: r.url, osumat: r.osumat });
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, tyontekija));
  console.log(`\nRosteri löytyi: miehet ${lista.length - epaonnistuneet.M.length}/${lista.length}, naiset ${lista.length - epaonnistuneet.N.length}/${lista.length}`);
  console.log(`\n=== OSUMAT (${tulokset.length}) ===`);
  for (const t of tulokset) {
    console.log(`\n## ${t.koulu} [${t.sarja}] ${t.url}`);
    for (const o of [...new Set(t.osumat)].slice(0, 6)) console.log("  … " + o);
  }
  console.log(`\n=== ROSTERIA EI LÖYTYNYT: MIEHET (${epaonnistuneet.M.length}) ===\n${epaonnistuneet.M.join("; ")}`);
  console.log(`\n=== ROSTERIA EI LÖYTYNYT: NAISET (${epaonnistuneet.N.length}) ===\n${epaonnistuneet.N.join("; ")}`);
})().catch((e) => { console.error(e); process.exit(1); });
