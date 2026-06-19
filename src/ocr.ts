import Tesseract from 'tesseract.js';

import type { DraftBook } from './types';

export interface OcrProgress {
  status: string;
  progress: number;
}

export interface CoverScanResult {
  draft: DraftBook;
  rawText: string;
  matchedSource?: string;
}

interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  number_of_pages_median?: number;
  cover_i?: number;
  subject?: string[];
}

interface OpenLibraryResponse {
  docs?: OpenLibraryDoc[];
}

export function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Unable to read image file.'));
    reader.readAsDataURL(file);
  });
}

export async function readTextFromImage(image: string, onProgress?: (progress: OcrProgress) => void) {
  const result = await Tesseract.recognize(image, 'eng', {
    logger: (message) => {
      onProgress?.({
        status: message.status,
        progress: Math.round(message.progress * 100),
      });
    },
  });

  return result.data.text.trim();
}

export async function identifyBookFromCover(
  file: File,
  onProgress?: (progress: OcrProgress) => void,
): Promise<CoverScanResult> {
  const coverImage = await readImageFile(file);
  return identifyBookFromCoverImage(coverImage, onProgress);
}

export async function identifyBookFromCoverImage(
  coverImage: string,
  onProgress?: (progress: OcrProgress) => void,
): Promise<CoverScanResult> {
  const rawText = await readTextFromImage(coverImage, onProgress);
  const lines = normalizeLines(rawText);
  const metadata = await searchOpenLibrary(lines);
  const fallback = inferBookFromLines(lines);

  return {
    rawText,
    matchedSource: metadata ? 'Open Library' : undefined,
    draft: {
      title: metadata?.title ?? fallback.title,
      author: metadata?.author ?? fallback.author,
      totalPages: metadata?.totalPages ?? 0,
      genres: metadata?.genres ?? [],
      coverImage: metadata?.coverImage ?? coverImage,
    },
  };
}

export async function readPageNumberFromImage(file: File, onProgress?: (progress: OcrProgress) => void) {
  const image = await readImageFile(file);
  return readPageNumberFromImageSource(image, onProgress);
}

export async function readPageNumberFromImageSource(
  image: string,
  onProgress?: (progress: OcrProgress) => void,
) {
  const rawText = await readTextFromImage(image, onProgress);
  const page = inferPageNumber(rawText);

  return { page, rawText };
}

export function inferPageNumber(rawText: string) {
  const matches = rawText.match(/\b\d{1,4}\b/g) ?? [];
  const numbers = matches
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value < 3000);

  if (numbers.length === 0) {
    return 0;
  }

  return Math.max(...numbers);
}

function normalizeLines(rawText: string) {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/[^\w\s:'’&.-]/g, '').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 1)
    .filter((line) => !/^(isbn|penguin|random house|harper|simon|schuster|book|novel)$/i.test(line));
}

function inferBookFromLines(lines: string[]) {
  const authorLine =
    lines.find((line) => /^by\s+/i.test(line)) ??
    lines.find((line) => /^[a-z][a-z'.-]+ [a-z][a-z'.-]+$/i.test(line));
  const titleLine =
    lines.find((line) => line !== authorLine && line.length > 3) ??
    lines[0] ??
    'Untitled book';

  return {
    title: titleLine.replace(/^title\s*:?/i, '').trim() || 'Untitled book',
    author: authorLine?.replace(/^by\s+/i, '').trim() || 'Unknown author',
  };
}

async function searchOpenLibrary(lines: string[]) {
  const query = lines.slice(0, 4).join(' ').trim();

  if (query.length < 3) {
    return null;
  }

  try {
    const response = await fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`,
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as OpenLibraryResponse;
    const best = data.docs?.find((doc) => doc.title && doc.author_name?.length);

    if (!best?.title) {
      return null;
    }

    return {
      title: best.title,
      author: best.author_name?.[0] ?? 'Unknown author',
      totalPages: best.number_of_pages_median ?? 0,
      coverImage: best.cover_i
        ? `https://covers.openlibrary.org/b/id/${best.cover_i}-L.jpg`
        : undefined,
      genres: selectGenres(best.subject ?? []),
    };
  } catch {
    return null;
  }
}

function selectGenres(subjects: string[]) {
  const preferred = [
    'fiction',
    'fantasy',
    'history',
    'biography',
    'memoir',
    'science',
    'romance',
    'mystery',
    'philosophy',
    'poetry',
  ];

  return preferred.filter((genre) =>
    subjects.some((subject) => subject.toLowerCase().includes(genre)),
  );
}
