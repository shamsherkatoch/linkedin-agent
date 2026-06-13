export interface NewsItem {
  title: string;
  url: string;
  content: string;
  publishedAt?: string;
}

export interface Draft {
  text: string;
  sourceUrl: string;
}

export interface HistoryEntry {
  topic: string;
  url: string;
  date: string;
  text: string;
}
