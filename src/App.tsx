import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';

import {
  identifyBookFromCover,
  readPageNumberFromImage,
  type CoverScanResult,
  type OcrProgress,
} from './ocr';
import { calculateStats, createId, loadBooks, saveBooks, toISODate } from './storage';
import type { Book, DraftBook, DraftSession, ReadingSession } from './types';

const emptyDraftBook: DraftBook = {
  title: '',
  author: '',
  totalPages: 0,
  genres: [],
};

function App() {
  const [books, setBooks] = useState<Book[]>(() => loadBooks());
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const stats = useMemo(() => calculateStats(books), [books]);
  const selectedBook = books.find((book) => book.id === selectedBookId) ?? books[0] ?? null;

  useEffect(() => {
    saveBooks(books);
  }, [books]);

  useEffect(() => {
    if (!selectedBookId && books[0]) {
      setSelectedBookId(books[0].id);
    }
  }, [books, selectedBookId]);

  function addBook(draft: DraftBook) {
    const now = new Date().toISOString();
    const book: Book = {
      id: createId('book'),
      title: draft.title.trim() || 'Untitled book',
      author: draft.author.trim() || 'Unknown author',
      coverImage: draft.coverImage,
      currentPage: 0,
      totalPages: Number(draft.totalPages) || 0,
      rating: 0,
      genres: normalizeGenres(draft.genres),
      status: 'reading',
      createdAt: now,
      sessions: [],
    };

    setBooks((current) => [book, ...current]);
    setSelectedBookId(book.id);
  }

  function updateBook(bookId: string, updates: Partial<Book>) {
    setBooks((current) =>
      current.map((book) => (book.id === bookId ? { ...book, ...updates } : book)),
    );
  }

  function recordSession(draft: DraftSession) {
    setBooks((current) =>
      current.map((book) => {
        if (book.id !== draft.bookId) {
          return book;
        }

        const nextPage = Math.max(0, Number(draft.page) || 0);
        const totalPages = Math.max(book.totalPages, nextPage);
        const finished = totalPages > 0 && nextPage >= totalPages;
        const session: ReadingSession = {
          id: createId('session'),
          date: draft.date,
          page: nextPage,
          pagesRead: Math.max(0, Number(draft.pagesRead) || 0),
          takeaway: draft.takeaway.trim(),
        };

        return {
          ...book,
          totalPages,
          currentPage: nextPage,
          status: finished ? 'finished' : 'reading',
          finishedAt: finished ? new Date().toISOString() : book.finishedAt,
          sessions: [session, ...book.sessions],
        };
      }),
    );
  }

  function removeBook(bookId: string) {
    setBooks((current) => current.filter((book) => book.id !== bookId));
    setSelectedBookId((current) => (current === bookId ? null : current));
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Shelf Notes</p>
          <h1>Your bookshelf, reading journal, and progress tracker in one quiet place.</h1>
          <p className="hero-copy">
            Snap a book cover to identify the title and author. Snap your last page to log
            progress, then leave takeaways as naturally as writing in the margin.
          </p>
        </div>
        <StatsPanel stats={stats} />
      </section>

      <section className="workspace-grid">
        <div className="left-column">
          <AddBookPanel onAddBook={addBook} />
          <BookShelf
            books={books}
            selectedBookId={selectedBook?.id ?? null}
            onSelectBook={setSelectedBookId}
          />
        </div>

        <ReadingJournal
          book={selectedBook}
          books={books}
          onRecordSession={recordSession}
          onUpdateBook={updateBook}
          onRemoveBook={removeBook}
        />
      </section>
    </main>
  );
}

interface StatsPanelProps {
  stats: ReturnType<typeof calculateStats>;
}

function StatsPanel({ stats }: StatsPanelProps) {
  return (
    <div className="stats-card" aria-label="Reading statistics">
      <Stat label="Books finished" value={stats.booksFinished} />
      <Stat label="Pages / reading day" value={stats.averagePagesPerDay} />
      <Stat label="Reading streak" value={`${stats.readingStreak}d`} />
      <Stat label="Pages logged" value={stats.totalPagesRead} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

interface AddBookPanelProps {
  onAddBook: (draft: DraftBook) => void;
}

function AddBookPanel({ onAddBook }: AddBookPanelProps) {
  const [draft, setDraft] = useState<DraftBook>(emptyDraftBook);
  const [genreText, setGenreText] = useState('');
  const [rawText, setRawText] = useState('');
  const [scanSource, setScanSource] = useState('');
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState('');

  async function handleCoverUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setError('');
    setIsScanning(true);
    setProgress({ status: 'Reading cover', progress: 0 });

    try {
      const result: CoverScanResult = await identifyBookFromCover(file, setProgress);
      setDraft(result.draft);
      setGenreText(result.draft.genres.join(', '));
      setRawText(result.rawText);
      setScanSource(result.matchedSource ?? 'Cover OCR');
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Unable to scan this cover.');
    } finally {
      setIsScanning(false);
      event.target.value = '';
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onAddBook({ ...draft, genres: splitGenres(genreText) });
    setDraft(emptyDraftBook);
    setGenreText('');
    setRawText('');
    setScanSource('');
    setProgress(null);
  }

  return (
    <section className="panel add-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Add a book</p>
          <h2>Scan the cover</h2>
        </div>
        <label className="photo-button">
          <input type="file" accept="image/*" capture="environment" onChange={handleCoverUpload} />
          Snap cover
        </label>
      </div>

      {isScanning && <ProgressNote progress={progress} />}
      {error && <p className="error">{error}</p>}

      <form className="book-form" onSubmit={handleSubmit}>
        <label>
          Title
          <input
            value={draft.title}
            placeholder="The Left Hand of Darkness"
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>
        <label>
          Author
          <input
            value={draft.author}
            placeholder="Ursula K. Le Guin"
            onChange={(event) => setDraft({ ...draft, author: event.target.value })}
          />
        </label>
        <div className="form-row">
          <label>
            Total pages
            <input
              type="number"
              min="0"
              value={draft.totalPages || ''}
              placeholder="304"
              onChange={(event) =>
                setDraft({ ...draft, totalPages: Number(event.target.value) || 0 })
              }
            />
          </label>
          <label>
            Genres
            <input
              value={genreText}
              placeholder="fiction, sci-fi"
              onChange={(event) => setGenreText(event.target.value)}
            />
          </label>
        </div>
        <button type="submit" disabled={!draft.title.trim()}>
          Place on shelf
        </button>
      </form>

      {rawText && (
        <details className="ocr-details">
          <summary>Scan notes {scanSource ? `from ${scanSource}` : ''}</summary>
          <pre>{rawText}</pre>
        </details>
      )}
    </section>
  );
}

function BookShelf({
  books,
  selectedBookId,
  onSelectBook,
}: {
  books: Book[];
  selectedBookId: string | null;
  onSelectBook: (bookId: string) => void;
}) {
  return (
    <section className="panel shelf-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Bookshelf</p>
          <h2>{books.length} books</h2>
        </div>
      </div>

      {books.length === 0 ? (
        <div className="empty-state">
          <span>+</span>
          <p>Your first book will appear here after you scan a cover or enter it by hand.</p>
        </div>
      ) : (
        <div className="shelf-list">
          {books.map((book) => (
            <button
              className={`book-card ${book.id === selectedBookId ? 'selected' : ''}`}
              key={book.id}
              type="button"
              onClick={() => onSelectBook(book.id)}
            >
              <BookCover book={book} />
              <div>
                <strong>{book.title}</strong>
                <span>{book.author}</span>
                <ProgressBar book={book} />
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function ReadingJournal({
  book,
  books,
  onRecordSession,
  onUpdateBook,
  onRemoveBook,
}: {
  book: Book | null;
  books: Book[];
  onRecordSession: (draft: DraftSession) => void;
  onUpdateBook: (bookId: string, updates: Partial<Book>) => void;
  onRemoveBook: (bookId: string) => void;
}) {
  if (!book) {
    return (
      <section className="panel journal-panel empty-journal">
        <p className="eyebrow">Reading journal</p>
        <h2>A blank page for your next read.</h2>
        <p>Add a book to begin logging pages, takeaways, ratings, and genres.</p>
      </section>
    );
  }

  return (
    <section className="panel journal-panel">
      <div className="journal-header">
        <BookCover book={book} large />
        <div>
          <p className="eyebrow">Now reading</p>
          <h2>{book.title}</h2>
          <p className="muted">by {book.author}</p>
          <ProgressBar book={book} showLabel />
          <GenreEditor book={book} onUpdateBook={onUpdateBook} />
          <RatingEditor book={book} onUpdateBook={onUpdateBook} />
        </div>
      </div>

      <PageScanner book={book} onRecordSession={onRecordSession} />
      <ReadingTrend books={books} />
      <SessionList sessions={book.sessions} />

      <button className="danger-button" type="button" onClick={() => onRemoveBook(book.id)}>
        Remove from shelf
      </button>
    </section>
  );
}

function PageScanner({
  book,
  onRecordSession,
}: {
  book: Book;
  onRecordSession: (draft: DraftSession) => void;
}) {
  const [page, setPage] = useState(book.currentPage || 0);
  const [date, setDate] = useState(toISODate());
  const [takeaway, setTakeaway] = useState('');
  const [rawText, setRawText] = useState('');
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setPage(book.currentPage || 0);
    setTakeaway('');
    setRawText('');
    setError('');
  }, [book.id, book.currentPage]);

  const pagesRead = Math.max(0, page - book.currentPage);

  async function handlePageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setError('');
    setIsScanning(true);
    setProgress({ status: 'Reading page', progress: 0 });

    try {
      const result = await readPageNumberFromImage(file, setProgress);
      setPage(result.page || book.currentPage);
      setRawText(result.rawText);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Unable to read this page.');
    } finally {
      setIsScanning(false);
      event.target.value = '';
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onRecordSession({
      bookId: book.id,
      date,
      page,
      pagesRead,
      takeaway,
    });
    setTakeaway('');
    setRawText('');
  }

  return (
    <section className="session-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Session log</p>
          <h3>Snap your last page</h3>
        </div>
        <label className="photo-button secondary">
          <input type="file" accept="image/*" capture="environment" onChange={handlePageUpload} />
          Snap page
        </label>
      </div>

      {isScanning && <ProgressNote progress={progress} />}
      {error && <p className="error">{error}</p>}

      <form className="session-form" onSubmit={handleSubmit}>
        <div className="form-row">
          <label>
            Date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            Last page
            <input
              type="number"
              min="0"
              value={page || ''}
              onChange={(event) => setPage(Number(event.target.value) || 0)}
            />
          </label>
        </div>
        <p className="session-meta">
          {pagesRead} pages since your last log. Current page is {book.currentPage}.
        </p>
        <label>
          Takeaways
          <textarea
            value={takeaway}
            placeholder="What stayed with you from this session?"
            onChange={(event) => setTakeaway(event.target.value)}
          />
        </label>
        <button type="submit" disabled={page <= 0}>
          Save reading session
        </button>
      </form>

      {rawText && (
        <details className="ocr-details">
          <summary>Page OCR text</summary>
          <pre>{rawText}</pre>
        </details>
      )}
    </section>
  );
}

function ReadingTrend({ books }: { books: Book[] }) {
  const days = useMemo(() => {
    const pagesByDay = new Map<string, number>();
    for (const session of books.flatMap((book) => book.sessions)) {
      pagesByDay.set(session.date, (pagesByDay.get(session.date) ?? 0) + session.pagesRead);
    }

    return Array.from({ length: 14 }, (_, index) => {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() - (13 - index));
      const key = toISODate(date);
      return {
        date: key,
        pages: pagesByDay.get(key) ?? 0,
      };
    });
  }, [books]);
  const maxPages = Math.max(1, ...days.map((day) => day.pages));

  return (
    <section className="trend-card" aria-label="Reading pages over the last 14 days">
      <div>
        <p className="eyebrow">Reading over time</p>
        <h3>Last 14 days</h3>
      </div>
      <div className="bar-chart">
        {days.map((day) => (
          <div className="bar-column" key={day.date}>
            <span
              className="bar"
              style={{ height: `${Math.max(8, (day.pages / maxPages) * 100)}%` }}
              title={`${day.date}: ${day.pages} pages`}
            />
            <small>{new Date(`${day.date}T12:00:00`).getDate()}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function SessionList({ sessions }: { sessions: ReadingSession[] }) {
  return (
    <section className="session-history">
      <div>
        <p className="eyebrow">Takeaways</p>
        <h3>{sessions.length ? 'Reading notes' : 'No notes yet'}</h3>
      </div>
      <div className="notes-list">
        {sessions.map((session) => (
          <article className="note-card" key={session.id}>
            <div>
              <strong>{formatDate(session.date)}</strong>
              <span>
                Page {session.page} · {session.pagesRead} pages
              </span>
            </div>
            <p>{session.takeaway || 'No takeaway written for this session.'}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function RatingEditor({
  book,
  onUpdateBook,
}: {
  book: Book;
  onUpdateBook: (bookId: string, updates: Partial<Book>) => void;
}) {
  return (
    <div className="rating-editor" aria-label="Rate book out of five stars">
      {Array.from({ length: 5 }, (_, index) => {
        const rating = index + 1;
        return (
          <button
            aria-label={`Rate ${rating} stars`}
            className={rating <= book.rating ? 'filled' : ''}
            key={rating}
            type="button"
            onClick={() => onUpdateBook(book.id, { rating })}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}

function GenreEditor({
  book,
  onUpdateBook,
}: {
  book: Book;
  onUpdateBook: (bookId: string, updates: Partial<Book>) => void;
}) {
  const [genreText, setGenreText] = useState(book.genres.join(', '));

  useEffect(() => {
    setGenreText(book.genres.join(', '));
  }, [book.id, book.genres]);

  return (
    <label className="genre-editor">
      Genres
      <input
        value={genreText}
        placeholder="memoir, philosophy"
        onBlur={() => onUpdateBook(book.id, { genres: splitGenres(genreText) })}
        onChange={(event) => setGenreText(event.target.value)}
      />
    </label>
  );
}

function BookCover({ book, large = false }: { book: Book; large?: boolean }) {
  return (
    <div className={`cover ${large ? 'large' : ''}`}>
      {book.coverImage ? (
        <img src={book.coverImage} alt={`Cover of ${book.title}`} />
      ) : (
        <span>{initials(book.title)}</span>
      )}
    </div>
  );
}

function ProgressBar({ book, showLabel = false }: { book: Book; showLabel?: boolean }) {
  const percent = book.totalPages ? Math.min(100, (book.currentPage / book.totalPages) * 100) : 0;

  return (
    <div className="progress-wrap">
      {showLabel && (
        <p>
          Page {book.currentPage} of {book.totalPages || '?'} · {Math.round(percent)}%
        </p>
      )}
      <span className="progress-bar">
        <span style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}

function ProgressNote({ progress }: { progress: OcrProgress | null }) {
  return (
    <p className="progress-note">
      {progress?.status ?? 'Scanning'} {progress ? `${progress.progress}%` : ''}
    </p>
  );
}

function splitGenres(value: string) {
  return value
    .split(',')
    .map((genre) => genre.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeGenres(genres: string[]) {
  return Array.from(new Set(genres.map((genre) => genre.trim().toLowerCase()).filter(Boolean)));
}

function initials(title: string) {
  return title
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

export default App;
