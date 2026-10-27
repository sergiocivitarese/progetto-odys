# Design system Odys

Fonte: brand board Odys (`docs/riferimenti/odys-brand-board.webp`), concept 5 "The Compass" come logo principale.
Codice: `apps/web/src/styles/_tokens.scss` (token) e `apps/web/src/app/shared/ui/` (componenti).

## Principi
1. **Coerenza prima della creatività**: i componenti usano solo token semantici (`--color-*`, `--space-*`), mai valori fissi.
2. **Il dato dichiara il suo stato**: ogni informazione incerta mostra un badge (icona + testo, mai solo colore).
3. **Mobile first**: tab bar in basso e dialoghi a "bottom sheet" su mobile; header con menu, colonne e pannelli fissi su desktop.
4. **Contrasto**: testo su lime sempre in Ink; testo su blu sempre bianco; il corallo è usato come superficie o bordo, per il testo si usa la sua variante scura.

## Palette

| Token brand | Valore | Uso |
|---|---|---|
| `--odys-ink` | `#111111` | Testo, pannelli di brand (hero, riepiloghi, mappa) |
| `--odys-off-white` | `#F8F7F3` | Sfondo dell'app |
| `--odys-blue` | `#3157FF` | Azione primaria, link, selezione |
| `--odys-lime` | `#D8F64E` | CTA principale ("Nuovo viaggio"), accenti su scuro, stato confermato |
| `--odys-coral` | `#FF695A` | Attenzione, errori, azioni distruttive |

### Token semantici (tema chiaro → scuro automatico)

| Token | Chiaro | Scuro | Uso |
|---|---|---|---|
| `--color-bg` | Off White | `#0E0E0E` | Sfondo pagina |
| `--color-surface` | `#FFFFFF` | `#181818` | Card, campi |
| `--color-surface-muted` | `#EFEDE6` | `#222220` | Sfondi secondari |
| `--color-brand-panel` | Ink | `#1D1D1B` | Hero e pannelli scuri |
| `--color-text` / `-muted` | Ink / `#5C5A54` | Off White / `#A9A79F` | Testo |
| `--color-primary` | Blue | Blue | Bottone primario |
| `--color-accent` | Lime | Lime | CTA principale |
| `--color-danger` / `-text` | Coral / `#B8321F` | Coral / `#FF8A7E` | Errori |

### Tema chiaro / scuro
- **Chiaro è il tema predefinito** (quello della brand board): sfondo Off White, testo Ink, pannelli di brand in Ink.
- Il selettore nell'header (sole / luna / schermo) offre **Chiaro, Scuro, Automatico**; la scelta resta salvata nel browser (`odys_theme_v1`).
- In entrambi i temi restano gli stessi colori brand: Blue per le azioni, Lime per la CTA principale, Coral per gli avvisi.
- Implementazione: `core/state/theme.store.ts` imposta `<html data-theme>`; uno script in `index.html` lo applica prima dell'avvio per evitare lampi di colore.

### Leggibilità
- Testo base 16px, interlinea 1.6, righe al massimo di 68 caratteri (`--measure`).
- Nessun testo informativo sotto i 13px (`--text-xs`); solo attribuzioni e micro-etichette a 11–12px.
- Contrasti: testo secondario ≥ 7:1, link e eyebrow in Blue scurito (≥ 5.9:1), bordi di campi e chip ≥ 3:1.
- Sui pannelli di brand si usano `--color-on-brand` e `--color-on-brand-muted` (≥ 10:1), mai grigi scritti a mano.

## Tipografia

| Ruolo | Font | Peso | Token |
|---|---|---|---|
| Brand / titoli | Plus Jakarta Sans | 800 (corsivo per gli accenti) | `--font-brand` |
| UI / testo | Inter | 400–700 | `--font-ui` |

Scala: `--text-xs` 13 · `sm` 14 · `md` 16 · `lg` 18 · `xl` 22 · `2xl` 28 · `3xl` fluido 32→52.
Eyebrow (etichette sopra i titoli): maiuscolo, 12px, spaziatura `0.14em`, colore primario (classe `.eyebrow`).

## Spaziatura, forme, movimento
- Spaziatura base 4px: `--space-1` (4) … `--space-16` (64).
- Raggi: `sm` 10 · `md` 14 · `lg` 20 · `xl` 28 · `pill`.
- Ombre: `sm`, `md` (hover card), `lg` (dialoghi).
- Durate: `fast` 120ms, `base` 200ms; `prefers-reduced-motion` disattiva le animazioni.

## Componenti (`shared/ui`)

| Componente | Selettore | Varianti / stati |
|---|---|---|
| Button | `button[odysButton]`, `a[odysButton]` | `primary`, `accent`, `secondary`, `ghost`, `danger` · `sm/md/lg` · `loading`, `disabled`, `block` · icona iniziale/finale |
| Chip | `button[odysChip]` | `selected` (Ink pieno + spunta), `aria-pressed` |
| Text field | `odys-text-field` | testo, data, ora, multilinea · icona · hint · focus ring blu |
| Status badge | `odys-status-badge` | 8 stati dati (vedi sotto) · `detail` opzionale |
| Notice | `odys-notice` | `info`, `success`, `warning`, `danger` (ruolo `alert` per gli errori) |
| Dialog | `odys-dialog` | `<dialog>` nativo: focus trap, Esc, clic fuori; bottom sheet < 640px |
| Empty state | `odys-empty-state` | icona, titolo, descrizione, azione |
| Section header | `odys-section-header` | eyebrow + titolo + contenuto a destra |
| Info row | `odys-info-row` | icona + etichetta + valore (su chiaro e su scuro) |
| Icon | `odys-icon` | registro Lucide, `aria-hidden` |
| Logo | `odys-logo` | `wordmark` (Compass + "dys"), `mark` (app icon) |

## Stati dei dati

| Stato | Aspetto | Significato |
|---|---|---|
| Confermato | lime tenue, spunta | verificato da provider o utente |
| Simulato | blu tenue, copia | dato demo o stima |
| Offline | grigio, wifi barrato | ultimo dato salvato, rete assente |
| Da verificare | corallo tenue, triangolo | risultato da confermare |
| Mancante | bordo corallo tratteggiato | informazione assente |
| Da definire | bordo grigio tratteggiato | non ancora inserito |
| Non disponibile | grigio barrato | provider non disponibile |
| Completata | Ink + testo lime | attività o tratta svolta |

## Layout responsive

| Breakpoint | Comportamento |
|---|---|
| < 640px | una colonna, dialoghi a bottom sheet, tab bar in basso |
| ≥ 640px | griglie a 2 colonne nei moduli, dialoghi centrati |
| ≥ 900px | header con menu completo e CTA "Nuovo viaggio", tab bar nascosta |
| ≥ 1024px | Home e Planner a due colonne con riepilogo fisso |
| ≥ 1100px | Itinerario: timeline + pannello "Oggi" fisso (mappa, meteo, prossima attività) |

Contenuto massimo 1180px, margini 16px (mobile) / 24px (desktop).
