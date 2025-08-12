# PDC Capacity Simulator (SVG) — MVP

React + Vite + Tailwind app to visualize PDC capacity by hour, shift, and day.

## Local dev
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## Deploy (Vercel - easiest)
1) Push this folder to a new GitHub repo.
2) Import the repo in https://vercel.com/new
3) Framework preset: **Vite**. Build command: `npm run build`. Output dir: `dist`.
4) Deploy. Share the URL.

## Deploy (GitHub Pages)
Use a GH Action for Vite -> Pages or run `vite build` and publish `dist/` to Pages.

## Deploy (S3 + CloudFront)
Upload `dist/` to an S3 static site bucket and front with CloudFront. Cache `index.html` with no/short cache.
