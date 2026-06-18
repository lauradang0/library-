export type BookStatus = 'reading' | 'finished' | 'want-to-read';

export interface ReadingSession {
  id: string;
  date: string;
  page: number;
  pagesRead: number;
  takeaway: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  coverImage?: string;
  currentPage: number;
  totalPages: number;
  rating: number;
  genres: string[];
  status: BookStatus;
  createdAt: string;
  finishedAt?: string;
  sessions: ReadingSession[];
}

export interface DraftBook {
  title: string;
  author: string;
  totalPages: number;
  genres: string[];
  coverImage?: string;
}

export interface DraftSession {
  bookId: string;
  date: string;
  page: number;
  pagesRead: number;
  takeaway: string;
}

export interface ReadingStats {
  booksFinished: number;
  averagePagesPerDay: number;
  readingStreak: number;
  totalPagesRead: number;
  activeBooks: number;
}
