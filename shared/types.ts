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
  /**
   * 22-character Spotify track id, or empty. A song has at most one recording (a YouTube video, a
   * Spotify track or an audio file), because sync pins belong to one recording.
   */
  spotifyId: string;
  /** File name of the user's own recording inside library/audio (e.g. an MP3 or WAV), or empty. */
  audioFile: string;
  /** The audio file's original name, for display. */
  audioName: string;
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
  /** Id of the Fretlane Cloud tab this song was imported from, when it came from the cloud. */
  cloudId?: string;
  /** Written in Fretlane's tab editor (Premium): the tab is alphaTex the editor can open again. */
  written?: boolean;
  /**
   * The `updatedAt` a written song had when it was last backed up to Fretlane Cloud (its
   * `cloudId` is that backup). Different from `updatedAt` means there are changes to upload.
   */
  cloudSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewSongInput {
  title?: string;
  artist?: string;
  youtube?: string;
  /** A YouTube or Spotify link (replaces `youtube` when given). */
  media?: string;
  tags?: string[];
  /** One of these three provides the tab. */
  tabUrl?: string;
  tabText?: string;
  tabFile?: { name: string; dataBase64: string };
  syncPoints?: SyncPoint[];
  /** Set when the tab comes from Fretlane Cloud. */
  cloudId?: string;
  /** Written in the tab editor; the tab must be alphaTex (tabText or a .atex tabFile). */
  written?: boolean;
}

export type SongPatch = Partial<Pick<Song, 'title' | 'artist' | 'youtubeId' | 'syncPoints' | 'defaultTrack' | 'tags' | 'favorite'>> & {
  youtube?: string;
  /**
   * A YouTube or Spotify link; it replaces the song's recording (an audio file too), and an empty
   * string removes it. Audio files are uploaded with PUT /api/songs/:id/audio instead.
   */
  media?: string;
  /** true moves the song to the archive (marks it done), false restores it. */
  archived?: boolean;
};
