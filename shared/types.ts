/** A point that pins a bar of the tab to a moment in the YouTube video. */
export interface SyncPoint {
  /** 0-based master bar index. */
  bar: number;
  /** Seconds into the video where this bar starts. */
  time: number;
}

export type TabFormat = 'gp' | 'musicxml' | 'alphatex' | 'ascii';

export interface Song {
  id: string;
  title: string;
  artist: string;
  /** 11-character YouTube video id, or empty when the song has no video. */
  youtubeId: string;
  /** File name of the stored tab inside library/tabs. */
  tabFile: string;
  tabFormat: TabFormat;
  /** Where the tab originally came from (URL or original file name), for reference. */
  tabSource: string;
  /**
   * Bar -> video time mapping. With one point the tab is played at its own tempo from that
   * point on; more points let the tab follow tempo drift in the recording.
   */
  syncPoints: SyncPoint[];
  /** Track the player opens by default. */
  defaultTrack: number;
  tags: string[];
  /** Starred by the user; favorites are listed first and have their own filter. */
  favorite: boolean;
  /** When the user marked the song as done and moved it to the archive; null while active. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewSongInput {
  title?: string;
  artist?: string;
  youtube?: string;
  tags?: string[];
  /** One of these three provides the tab. */
  tabUrl?: string;
  tabText?: string;
  tabFile?: { name: string; dataBase64: string };
}

export type SongPatch = Partial<Pick<Song, 'title' | 'artist' | 'youtubeId' | 'syncPoints' | 'defaultTrack' | 'tags' | 'favorite'>> & {
  youtube?: string;
  /** true moves the song to the archive (marks it done), false restores it. */
  archived?: boolean;
};
