# samuel-koo.vercel.app

Personal portfolio of Samuel Koo, first-year Biomedical Engineering (Co-op) at the University of Waterloo.
Live at **https://samuel-koo.vercel.app**.

Every project on the site is shown with the test result behind it: NEPHRON, a camera hand-symptom checker,
a grip dynamometer, ResiliGuard, Duri and Biotron knee cycloidal parts.

## What's here

| Path | What it is |
|---|---|
| `index.html` | The whole page |
| `styles.css`, `tokens.css`, `base.css` | Styles; colours, type and spacing live in `tokens.css` |
| `main.js` | The 2D track map, the field switcher and the NEPHRON loop |
| `src/race3d.js` | Source of the 3D race (three.js) |
| `race3d.js` | The built 3D race, loaded only when a visitor presses "Play the 3D race" |
| `resume-src/` | LaTeX source of the résumé PDF |
| `images/`, `reports/` | Screenshots, the share image and project reports |

## Run locally

It is a static site, so any local server works:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Rebuild the 3D race after editing `src/race3d.js`

```bash
npm install --no-save three esbuild
npx esbuild src/race3d.js --bundle --minify --format=esm --outfile=race3d.js
```

## Rebuild the résumé

```bash
cd resume-src && pdflatex Samuel_Koo_Resume.tex && mv Samuel_Koo_Resume.pdf ../
```

## Deploy

Pushing to `main` deploys to production on Vercel. Other branches get preview links.
