import type { Book, ReadingStats } from './types';

const STORAGE_KEY = 'shelf-notes.books.v1';

export function loadBooks(): Book[] {
  const saved = window.localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    return [];
  }

  try {
    const books = JSON.parse(saved) as Book[];
    return Array.isArray(books) ? books : [];
  } catch {
    return [];
  }
}

export function saveBooks(books: Book[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
}

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function toISODate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function calculateStats(books: Book[], today = new Date()): ReadingStats {
  const allSessions = books.flatMap((book) => book.sessions);
  const pagesByDay = new Map<string, number>();

  for (const session of allSessions) {
    pagesByDay.set(session.date, (pagesByDay.get(session.date) ?? 0) + session.pagesRead);
  }

  const readingDays = Array.from(pagesByDay.values()).filter((pages) => pages > 0).length;
  const totalPagesRead = Array.from(pagesByDay.values()).reduce((sum, pages) => sum + pages, 0);

  return {
    booksFinished: books.filter((book) => book.status === 'finished').length,
    averagePagesPerDay: readingDays === 0 ? 0 : Math.round((totalPagesRead / readingDays) * 10) / 10,
    readingStreak: calculateReadingStreak(pagesByDay, today),
    totalPagesRead,
    activeBooks: books.filter((book) => book.status === 'reading').length,
  };
}

function calculateReadingStreak(pagesByDay: Map<string, number>, today: Date) {
  let streak = 0;
  const cursor = new Date(today);
  cursor.setHours(12, 0, 0, 0);

  while (true) {
    const key = toISODate(cursor);
    if ((pagesByDay.get(key) ?? 0) <= 0) {
      return streak;
    }

    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
}
