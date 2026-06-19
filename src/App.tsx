import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import {
  identifyBookFromCover,
  identifyBookFromCoverImage,
  readPageNumberFromImage,
  readPageNumberFromImageSource,
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
  const [sessionPromptBookId, setSessionPromptBookId] = useState<string | null>(null);
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

  function addBook(draft: DraftBook, options?: { promptForSession?: boolean }) {
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
    setSessionPromptBookId(options?.promptForSession ? book.id : null);

    return book.id;
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
    setSessionPromptBookId((current) => (current === draft.bookId ? null : current));
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
          <h1>A quiet camera shelf for every book you read.</h1>
          <p className="hero-copy">
            Point the camera at a cover to add it. Point it at your last page to update progress.
          </p>
        </div>
        <StatsPanel stats={stats} />
      </section>

      <section className="workspace-grid">
        <BookShelf
          books={books}
          selectedBookId={selectedBook?.id ?? null}
          onSelectBook={setSelectedBookId}
        />

        <aside className="journal-column">
          <AddBookPanel onAddBook={addBook} />
          <ReadingJournal
            book={selectedBook}
            books={books}
            promptForSession={selectedBook ? sessionPromptBookId === selectedBook.id : false}
            onRecordSession={recordSession}
            onUpdateBook={updateBook}
            onRemoveBook={removeBook}
          />
        </aside>
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
  onAddBook: (draft: DraftBook, options?: { promptForSession?: boolean }) => string;
}

function AddBookPanel({ onAddBook }: AddBookPanelProps) {
  const [draft, setDraft] = useState<DraftBook>(emptyDraftBook);
  const [genreText, setGenreText] = useState('');
  const [rawText, setRawText] = useState('');
  const [scanSource, setScanSource] = useState('');
  const [lastAddedTitle, setLastAddedTitle] = useState('');
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState('');

  function addScannedBook(result: CoverScanResult) {
    onAddBook(result.draft, { promptForSession: true });
    setDraft(emptyDraftBook);
    setGenreText('');
    setRawText(result.rawText);
    setScanSource(result.matchedSource ?? 'Cover OCR');
    setLastAddedTitle(result.draft.title || 'Untitled book');
  }

  async function scanCoverImage(image: string) {
    setError('');
    setIsScanning(true);
    setProgress({ status: 'Reading cover', progress: 0 });

    try {
      const result: CoverScanResult = await identifyBookFromCoverImage(image, setProgress);
      addScannedBook(result);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Unable to scan this cover.');
    } finally {
      setIsScanning(false);
    }
  }

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
      addScannedBook(result);
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
    setLastAddedTitle('');
    setProgress(null);
  }

  return (
    <section className="panel add-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Add a book</p>
          <h2>Camera scan</h2>
        </div>
        <CameraCapture
          buttonLabel="Point at cover"
          title="Point camera at the book cover"
          helpText="Fill the frame with the front cover, then capture. The title and author stay editable."
          onCapture={scanCoverImage}
        />
      </div>

      {isScanning && <ProgressNote progress={progress} />}
      {error && <p className="error">{error}</p>}
      {lastAddedTitle && (
        <div className="success-note">
          <strong>{lastAddedTitle}</strong> was added to your shelf. Now log the page you are on
          and your thoughts in the reading session card.
        </div>
      )}

      <details className="manual-entry">
        <summary>Type a book in manually</summary>
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
      </details>

      <details className="fallback-upload">
        <summary>No camera? Upload a cover photo</summary>
        <label className="file-drop">
          Choose image
          <input type="file" accept="image/*" onChange={handleCoverUpload} />
        </label>
      </details>

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
  promptForSession,
  onRecordSession,
  onUpdateBook,
  onRemoveBook,
}: {
  book: Book | null;
  books: Book[];
  promptForSession: boolean;
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
          <BookDetailsEditor book={book} onUpdateBook={onUpdateBook} />
          <GenreEditor book={book} onUpdateBook={onUpdateBook} />
          <RatingEditor book={book} onUpdateBook={onUpdateBook} />
        </div>
      </div>

      <PageScanner book={book} promptForSession={promptForSession} onRecordSession={onRecordSession} />
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
  promptForSession,
  onRecordSession,
}: {
  book: Book;
  promptForSession: boolean;
  onRecordSession: (draft: DraftSession) => void;
}) {
  const [page, setPage] = useState(book.currentPage || 0);
  const [date, setDate] = useState(toISODate());
  const [takeaway, setTakeaway] = useState('');
  const [rawText, setRawText] = useState('');
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState('');
  const cardRef = useRef<HTMLElement | null>(null);
  const pageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setPage(book.currentPage || 0);
    setTakeaway('');
    setRawText('');
    setError('');
  }, [book.id, book.currentPage]);

  useEffect(() => {
    if (!promptForSession) {
      return;
    }

    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    pageInputRef.current?.focus();
  }, [promptForSession, book.id]);

  const pagesRead = Math.max(0, page - book.currentPage);

  async function scanPageImage(image: string) {
    setError('');
    setIsScanning(true);
    setProgress({ status: 'Reading page', progress: 0 });

    try {
      const result = await readPageNumberFromImageSource(image, setProgress);
      setPage(result.page || book.currentPage);
      setRawText(result.rawText);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Unable to read this page.');
    } finally {
      setIsScanning(false);
    }
  }

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
    <section className={`session-card ${promptForSession ? 'prompted' : ''}`} ref={cardRef}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Session log</p>
          <h3>What page are you on?</h3>
        </div>
        <CameraCapture
          buttonLabel="Point at page"
          title="Point camera at your last page"
          helpText="Center the page number in the view, then capture. You can correct the page before saving."
          onCapture={scanPageImage}
          secondary
        />
      </div>

      {isScanning && <ProgressNote progress={progress} />}
      {error && <p className="error">{error}</p>}
      {promptForSession && (
        <div className="session-prompt">
          Your book is on the shelf. Add the last page you reached and what you thought about this
          reading session.
        </div>
      )}

      <form className="session-form" onSubmit={handleSubmit}>
        <div className="form-row">
          <label>
            Date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            Last page
            <input
              ref={pageInputRef}
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
          Thoughts from this session
          <textarea
            value={takeaway}
            placeholder="What stood out, surprised you, or is worth remembering?"
            onChange={(event) => setTakeaway(event.target.value)}
          />
        </label>
        <button type="submit" disabled={page <= 0}>
          Save reading session
        </button>
      </form>

      <details className="fallback-upload">
        <summary>No camera? Upload a page photo</summary>
        <label className="file-drop">
          Choose image
          <input type="file" accept="image/*" onChange={handlePageUpload} />
        </label>
      </details>

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

function BookDetailsEditor({
  book,
  onUpdateBook,
}: {
  book: Book;
  onUpdateBook: (bookId: string, updates: Partial<Book>) => void;
}) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [totalPages, setTotalPages] = useState(book.totalPages || 0);

  useEffect(() => {
    setTitle(book.title);
    setAuthor(book.author);
    setTotalPages(book.totalPages || 0);
  }, [book.id, book.title, book.author, book.totalPages]);

  function saveDetails() {
    onUpdateBook(book.id, {
      title: title.trim() || 'Untitled book',
      author: author.trim() || 'Unknown author',
      totalPages: Math.max(book.currentPage, Number(totalPages) || 0),
    });
  }

  return (
    <details className="details-editor">
      <summary>Fix scanned details</summary>
      <div className="details-grid">
        <label>
          Title
          <input value={title} onBlur={saveDetails} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          Author
          <input
            value={author}
            onBlur={saveDetails}
            onChange={(event) => setAuthor(event.target.value)}
          />
        </label>
        <label>
          Total pages
          <input
            type="number"
            min="0"
            value={totalPages || ''}
            onBlur={saveDetails}
            onChange={(event) => setTotalPages(Number(event.target.value) || 0)}
          />
        </label>
      </div>
    </details>
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

function CameraCapture({
  buttonLabel,
  title,
  helpText,
  onCapture,
  secondary = false,
}: {
  buttonLabel: string;
  title: string;
  helpText: string;
  onCapture: (image: string) => void | Promise<void>;
  secondary?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;

    async function startCamera() {
      setCameraError('');

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });

        if (cancelled) {
          stopStream(stream);
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setCameraError('Camera access was blocked or is not available on this device.');
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        stopStream(streamRef.current);
        streamRef.current = null;
      }
    };
  }, [isOpen]);

  function closeCamera() {
    setIsOpen(false);
  }

  async function captureFrame() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError('Camera is still warming up. Try again in a moment.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');

    if (!context) {
      setCameraError('Could not capture a photo from this camera.');
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/jpeg', 0.92);
    closeCamera();
    await onCapture(image);
  }

  return (
    <>
      <button
        className={`photo-button ${secondary ? 'secondary' : ''}`}
        type="button"
        onClick={() => setIsOpen(true)}
      >
        {buttonLabel}
      </button>

      {isOpen && (
        <div className="camera-backdrop" role="dialog" aria-modal="true" aria-label={title}>
          <div className="camera-modal">
            <div className="camera-copy">
              <p className="eyebrow">Camera</p>
              <h3>{title}</h3>
              <p>{helpText}</p>
            </div>

            <div className="viewfinder">
              <video ref={videoRef} autoPlay muted playsInline />
              <span className="focus-frame" aria-hidden="true" />
            </div>

            {cameraError && <p className="error">{cameraError}</p>}

            <div className="camera-actions">
              <button className="ghost-button" type="button" onClick={closeCamera}>
                Cancel
              </button>
              <button className="photo-button" type="button" onClick={captureFrame}>
                Capture
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
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
