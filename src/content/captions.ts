// Native closed captions and subtitles: the `<track>` text tracks of a media
// element. Players that draw their own captions have none, and keep the key.

export type CaptionsToggle = {
  enabled: boolean;
  // The shown track's name, when it has one.
  label?: string;
};

// The track each media element last showed, so turning captions back on
// restores it instead of guessing again.
const lastShownTrack = new WeakMap<HTMLMediaElement, TextTrack>();
const watchedMedia = new WeakSet<HTMLMediaElement>();

/**
 * The tracks this extension may switch. A track in `hidden` mode is one the
 * page reads cues from to draw captions itself, as players such as Plyr and
 * Video.js do. Such a player manages all its tracks, so if any is hidden the
 * media is left alone: showing another track would draw its cues over the
 * player's own captions.
 */
function getCaptionTracks(media: HTMLMediaElement): TextTrack[] {
  const tracks = Array.from(media.textTracks).filter(
    (track) => track.kind === "captions" || track.kind === "subtitles",
  );
  return tracks.some((track) => track.mode === "hidden") ? [] : tracks;
}

export function hasCaptionTracks(media: HTMLMediaElement | null): boolean {
  return media !== null && getCaptionTracks(media).length > 0;
}

// Once the user has used the hotkey on a media, a track they pick in the
// player's own menu counts as the last one shown too, even if they also turn
// it off there.
function watchShownTrack(media: HTMLMediaElement): void {
  if (watchedMedia.has(media)) {
    return;
  }

  watchedMedia.add(media);
  media.textTracks.addEventListener("change", () => {
    const shown = getCaptionTracks(media).find((track) => track.mode === "showing");
    if (shown) {
      lastShownTrack.set(media, shown);
    }
  });
}

function getLanguageName(language: string): string | undefined {
  try {
    return new Intl.DisplayNames([navigator.language], { type: "language" }).of(language);
  } catch {
    // Not a valid language tag.
    return undefined;
  }
}

function getTrackLabel(track: TextTrack): string | undefined {
  const label = track.label.trim();
  if (label) {
    return label;
  }

  const language = track.language.trim();
  return language ? (getLanguageName(language) ?? language) : undefined;
}

// The page's language first, then the browser's. A full tag (`pt-BR`) beats a
// track for the same language alone (`pt`) only when it is an exact match.
function findTrackForLanguage(tracks: TextTrack[]): TextTrack | undefined {
  const wanted = [document.documentElement.lang, ...navigator.languages]
    .map((language) => language.trim().toLowerCase())
    .filter(Boolean);

  for (const language of wanted) {
    const base = language.split("-")[0];
    const match =
      tracks.find((track) => track.language.toLowerCase() === language) ??
      tracks.find((track) => track.language.toLowerCase().split("-")[0] === base);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function chooseTrackToShow(media: HTMLMediaElement, tracks: TextTrack[]): TextTrack {
  const last = lastShownTrack.get(media);
  if (last && tracks.includes(last)) {
    return last;
  }

  return findTrackForLanguage(tracks) ?? tracks[0];
}

/**
 * Turns captions off if a track is showing, otherwise on. Returns null when
 * the media has no track to switch, so the caller can leave the key alone.
 */
export function toggleCaptions(media: HTMLMediaElement): CaptionsToggle | null {
  const tracks = getCaptionTracks(media);
  if (tracks.length === 0) {
    return null;
  }

  watchShownTrack(media);
  const showing = tracks.filter((track) => track.mode === "showing");
  if (showing.length > 0) {
    lastShownTrack.set(media, showing[0]);
    for (const track of showing) {
      track.mode = "disabled";
    }
    return { enabled: false };
  }

  const track = chooseTrackToShow(media, tracks);
  track.mode = "showing";
  return { enabled: true, label: getTrackLabel(track) };
}
