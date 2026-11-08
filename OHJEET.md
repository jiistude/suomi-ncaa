# Ohjeet: Suomalaiset NCAA:ssa

Sivu kokoaa NCAA Division I:ssä pelaavien suomalaisten ottelut ja tulokset. Tämä ohje kertoo, miten sivu toimii ja miten sitä ylläpidetään.

## Miten sivu päivittyy

GitHubin robotti (Actions, työnkulku *Päivitä ottelut*) ajaa haun kolmesti päivässä: talviaikaan noin klo 06.40, 12.40 ja 19.40 Suomen aikaa. Aamun ajo tuo yön tulokset. Haku käynnistyy myös aina, kun repoon tehdään muutos.

Robotti hakee jokaisen joukkueen otteluohjelman koulun omalta sivustolta, rakentaa sivun ja tallentaa sen `docs/`-kansioon. GitHub Pages julkaisee kansion muutamassa minuutissa.

Haun voi käynnistää myös käsin: **Actions → Päivitä ottelut → Run workflow**.

## Tiedostot

| Tiedosto | Mitä se on | Muokataanko |
|---|---|---|
| `pelaajat.json` | Pelaajat ja joukkueiden lähteet | Kyllä, kun pelaajia tulee tai lähtee |
| `hae.js` | Haku ja sivun rakennus | Vain korjauksiin |
| `sivu.html` | Sivun pohja (ulkoasu) | Ulkoasumuutoksiin |
| `tilastot.js` | Tilastorivien luku pöytäkirjoista | Vain korjauksiin |
| `docs/` | Robotin tuottama valmis sivu | **Ei.** Kansio syntyy uudelleen joka ajossa |
| `docs/tilastot.json` | Jo luetut tilastorivit (välimuisti) | **Ei.** Jos tilastorivi on virheellinen, poista sen rivi: robotti hakee pöytäkirjan uudelleen |
| `tyokalut/koeajo.js` | Testaa, toimivatko kaikki lähteet | Ei |
| `tyokalut/tarkistus.js` | Tulostaa pull requestin ajossa yhteenvedon | Ei |

## Kuka on mukana

Pelaaja on mukana, jos Koripalloliitto listaa hänet suomalaispelaajaksi **ja** hän löytyy joukkueen virallisesta rosterista. Nimi ei vaikuta mihinkään. Kansalaisuuden ratkaisee liiton lista (ja tarvittaessa FIBA:n profiili), ei rosterin kotipaikka.

### Pelaajan lisääminen

1. Lisää pelaaja `pelaajat.json`-tiedoston `pelaajat`-listaan (mallia muista riveistä). Kenttä `joukkue` viittaa `joukkueet`-listan avaimeen.
2. Jos pelaajan joukkue on jo listalla, mitään muuta ei tarvita.
3. Jos joukkue on uusi, sille tarvitaan lähde. Tämä on teknisempi vaihe: pyydä Claudea selvittämään se.

### Pelaajan poistaminen

Poista rivi `pelaajat`-listasta. Jos joukkueella ei ole enää muita suomalaisia, poista myös joukkue `joukkueet`-listasta.

## Lähteet

| Tyyppi | Joukkueita | Mistä |
|---|---|---|
| `sidearm-ics` | 26 | Koulun kalenterisyöte (`…/calendar.ashx/calendar.ics?sport_id=…`). Tulos ja usein striimilinkki ovat mukana |
| `wmt-api` | 3 (UCLA, Northwestern, San Jose State) | Koulun sivuston otteluohjelma JSON-muodossa. Kauden tunniste haetaan joka kerta automaattisesti |
| `wmt-sivu` | 1 (Arkansas) | Koulun julkinen otteluohjelmasivu. Jos Arkansas muuttaa sivuaan, tämä lakkaa toimimasta ensimmäisenä |

Harjoitusottelut ja kauden alkua (`kauden_alku`) edeltävät ottelut jätetään pois. Suomalaisten keskinäiset ottelut näytetään yhtenä otteluna.

## Tilastorivit

Kun ottelu on pelattu ja pöytäkirja löytyy, robotti lukee pöytäkirjasta suomalaisten tilastot (minuutit, pisteet, levypallot, syötöt, riistot, torjunnat ja heitot) ja tallentaa ne tiedostoon `docs/tilastot.json`. Pöytäkirja haetaan vain kerran.

- **Pelaaja puuttuu pöytäkirjasta:** sivulla lukee "ei pelannut".
- **Pöytäkirja ei ole vielä valmis:** tilastoriviä ei näytetä, ja robotti yrittää uudelleen seuraavalla ajolla.
- **Lähteet:** koulujen pöytäkirjasivut (26 joukkuetta), WMT:n tilastopalvelut (UCLA, Northwestern, San Jose State) ja Arkansasin PDF-pöytäkirjat. PDF:n lukemiseen robotti asentaa joka ajossa `pdftotext`-ohjelman.

## Jos jokin menee rikki

| Oire | Syy ja korjaus |
|---|---|
| Sivun yläreunassa keltainen huomautus "Viimeisin päivitys ei onnistunut kaikille joukkueille" | Joidenkin koulujen haku epäonnistui. Niiden ottelut näytetään edellisestä onnistuneesta päivityksestä. Yksittäinen häiriö korjaantuu yleensä seuraavassa ajossa. Jos sama koulu on listalla päiväkausia, sen lähde on muuttunut |
| Robotin ajo on punainen (epäonnistui) | Yli kolmasosa lähteistä ei toiminut. Todennäköisesti verkko- tai GitHub-häiriö. Käynnistä ajo uudelleen käsin. Jos ongelma jatkuu, aja **Actions → Koeajo → Run workflow** ja katso tulostaulukosta, mitkä lähteet eivät toimi |
| Yhden pelaajan ottelut puuttuvat tai ovat vanhoja | Koulu on vaihtanut sivustoaan tai kalenterinsa osoitetta. Lähde päivitetään `pelaajat.json`-tiedostoon |
| Kellonaika on "aika auki" | Koulu ei ole vielä ilmoittanut alkamisaikaa. Päivittyy itsestään |
| Pelatulta ottelulta puuttuu tilastorivi päiväkausia | Koulun pöytäkirjan rakenne on muuttunut. Korjataan `tilastot.js`:ään. Muu sivu toimii normaalisti |
| Vastustajan nimessä on ylimääräistä tekstiä | Koulu on lisännyt otsikkoon kampanjatekstin uudessa muodossa. Korjataan `hae.js`:ään |

## Kausi vaihtuu

Ennen uutta kautta päivitetään `pelaajat.json`: `kausi`, `kauden_alku`, pelaajat (liiton uusi lista) ja joukkueet. SIDEARM-koulujen `sport_id` pysyy yleensä samana, mutta se kannattaa tarkistaa koeajolla.
