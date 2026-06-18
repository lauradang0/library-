# Shelf Notes

A clean, minimal personal library app that feels like a physical bookshelf meets a reading
journal.

## What it does

- Snap a photo of a book cover to extract text with in-browser OCR.
- Match likely title, author, page count, cover art, and genres through Open Library when possible.
- Edit every detected field before placing the book on your shelf.
- Snap a photo of the last page you read to detect the page number and log progress.
- Write takeaways after every reading session.
- Rate books out of 5 stars and tag them by genre.
- Track reading stats over time: books finished, pages per reading day, total pages, and streak.

All library data is stored locally in your browser with `localStorage`.

## Getting started

```bash
npm install
npm run dev
```

Open the local URL shown by Vite. On a phone or camera-enabled device, use the cover and page
photo buttons to capture images directly.

## Notes on photo recognition

The app uses Tesseract.js in the browser, so no OCR server or API key is required. Cover scans are
then used to query Open Library for richer book metadata. If OCR or matching is imperfect, the app
keeps the raw scan text visible and lets you correct title, author, pages, and genres before saving.
