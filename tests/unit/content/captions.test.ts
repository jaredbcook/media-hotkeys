import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeVideo,
  resetContentTestState,
  setTextTracks,
  showActionOverlayMock,
} from "./helpers.js";
import { handleAction } from "../../../src/content.js";
import { toggleCaptions } from "../../../src/content/captions.js";
import { state } from "../../../src/content/state.js";

beforeEach(() => {
  resetContentTestState();
  document.documentElement.lang = "";
});

type FakeTrack = { kind: string; mode: TextTrackMode; language: string; label: string };

function makeTrack(overrides: Partial<FakeTrack> = {}): TextTrack {
  return { kind: "captions", mode: "disabled", language: "", label: "", ...overrides } as TextTrack;
}

function makeCaptionedVideo(...tracks: TextTrack[]): HTMLVideoElement {
  const video = makeVideo();
  setTextTracks(video, tracks);
  return video;
}

function stubBrowserLanguages(...languages: string[]): void {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
}

describe("toggleCaptions", () => {
  it("shows the first track, then disables it again", () => {
    const track = makeTrack();
    const video = makeCaptionedVideo(track);

    expect(toggleCaptions(video)).toEqual({ enabled: true, label: undefined });
    expect(track.mode).toBe("showing");

    expect(toggleCaptions(video)).toEqual({ enabled: false });
    expect(track.mode).toBe("disabled");
  });

  it("returns null and changes nothing without a caption or subtitle track", () => {
    const chapters = makeTrack({ kind: "chapters" });
    const metadata = makeTrack({ kind: "metadata" });
    const descriptions = makeTrack({ kind: "descriptions" });

    expect(toggleCaptions(makeCaptionedVideo())).toBeNull();
    expect(toggleCaptions(makeCaptionedVideo(chapters, metadata, descriptions))).toBeNull();
    expect([chapters.mode, metadata.mode, descriptions.mode]).toEqual([
      "disabled",
      "disabled",
      "disabled",
    ]);
  });

  it("treats subtitle tracks like caption tracks", () => {
    const subtitles = makeTrack({ kind: "subtitles" });

    expect(toggleCaptions(makeCaptionedVideo(makeTrack({ kind: "chapters" }), subtitles))).toEqual({
      enabled: true,
      label: undefined,
    });
    expect(subtitles.mode).toBe("showing");
  });

  it("restores the track that was shown last", () => {
    const english = makeTrack({ language: "en" });
    const french = makeTrack({ language: "fr" });
    const video = makeCaptionedVideo(english, french);

    // The user picked French from the player's own menu.
    french.mode = "showing";
    toggleCaptions(video);
    expect([english.mode, french.mode]).toEqual(["disabled", "disabled"]);

    expect(toggleCaptions(video)).toEqual({ enabled: true, label: "French" });
    expect([english.mode, french.mode]).toEqual(["disabled", "showing"]);
  });

  it("remembers the shown track for each video separately", () => {
    const firstA = makeTrack({ language: "en" });
    const secondA = makeTrack({ language: "fr" });
    const videoA = makeCaptionedVideo(firstA, secondA);
    const videoB = makeCaptionedVideo(makeTrack({ language: "en" }), makeTrack({ language: "fr" }));

    secondA.mode = "showing";
    toggleCaptions(videoA);
    toggleCaptions(videoB);

    expect(Array.from(videoB.textTracks).map((track) => track.mode)).toEqual([
      "showing",
      "disabled",
    ]);
    expect(toggleCaptions(videoA)).toEqual({ enabled: true, label: "French" });
  });

  it("restores a track picked in the player's menu, even if it was turned off there", () => {
    const english = makeTrack({ language: "en" });
    const french = makeTrack({ language: "fr" });
    const video = makeVideo();
    const list = setTextTracks(video, [english, french]);

    toggleCaptions(video);
    toggleCaptions(video);
    expect([english.mode, french.mode]).toEqual(["disabled", "disabled"]);

    // The menu shows French, then turns captions off, each firing `change`.
    french.mode = "showing";
    list.dispatchEvent(new Event("change"));
    french.mode = "disabled";
    list.dispatchEvent(new Event("change"));

    expect(toggleCaptions(video)).toEqual({ enabled: true, label: "French" });
    expect([english.mode, french.mode]).toEqual(["disabled", "showing"]);
  });

  it("falls back to a fresh choice when the remembered track is gone", () => {
    const english = makeTrack({ language: "en" });
    const french = makeTrack({ language: "fr" });
    const video = makeVideo();
    setTextTracks(video, [english, french]);

    french.mode = "showing";
    toggleCaptions(video);
    setTextTracks(video, [english]);

    expect(toggleCaptions(video)).toEqual({ enabled: true, label: "English" });
    expect(english.mode).toBe("showing");
  });

  it("disables every track that is showing", () => {
    const first = makeTrack({ mode: "showing" });
    const second = makeTrack({ mode: "showing" });

    toggleCaptions(makeCaptionedVideo(first, second));

    expect([first.mode, second.mode]).toEqual(["disabled", "disabled"]);
  });

  describe("choosing a track to show", () => {
    it("prefers the page language", () => {
      document.documentElement.lang = "fr";
      stubBrowserLanguages("de");
      const english = makeTrack({ language: "en" });
      const german = makeTrack({ language: "de" });
      const french = makeTrack({ language: "fr" });

      toggleCaptions(makeCaptionedVideo(english, german, french));

      expect(french.mode).toBe("showing");
    });

    it("uses the browser language when the page language has no track", () => {
      document.documentElement.lang = "ja";
      stubBrowserLanguages("es-MX", "de");
      const english = makeTrack({ language: "en" });
      const german = makeTrack({ language: "de" });

      toggleCaptions(makeCaptionedVideo(english, german));

      expect(german.mode).toBe("showing");
    });

    it("matches a regional tag exactly before matching its language", () => {
      stubBrowserLanguages("pt-BR");
      const portugal = makeTrack({ language: "pt-PT" });
      const brazil = makeTrack({ language: "pt-BR" });

      toggleCaptions(makeCaptionedVideo(portugal, brazil));

      expect(brazil.mode).toBe("showing");
    });

    it("matches a track for the language alone against a regional tag", () => {
      stubBrowserLanguages("en-GB");
      const german = makeTrack({ language: "de" });
      const english = makeTrack({ language: "en" });

      toggleCaptions(makeCaptionedVideo(german, english));

      expect(english.mode).toBe("showing");
    });

    it("takes the first track when none matches", () => {
      stubBrowserLanguages("ko");
      const english = makeTrack({ language: "en" });
      const german = makeTrack({ language: "de" });

      toggleCaptions(makeCaptionedVideo(english, german));

      expect(english.mode).toBe("showing");
      expect(german.mode).toBe("disabled");
    });
  });

  describe("labels", () => {
    it("uses the track label", () => {
      const video = makeCaptionedVideo(makeTrack({ label: " English (auto) ", language: "en" }));

      expect(toggleCaptions(video)).toEqual({ enabled: true, label: "English (auto)" });
    });

    it("names the language when the track has no label", () => {
      expect(toggleCaptions(makeCaptionedVideo(makeTrack({ language: "de" })))).toEqual({
        enabled: true,
        label: "German",
      });
    });

    it("falls back to the raw language tag when it has no name", () => {
      expect(toggleCaptions(makeCaptionedVideo(makeTrack({ language: "x-!" })))).toEqual({
        enabled: true,
        label: "x-!",
      });
    });
  });

  describe("tracks the page draws itself", () => {
    it("leaves a hidden track alone", () => {
      const hidden = makeTrack({ mode: "hidden" });

      expect(toggleCaptions(makeCaptionedVideo(hidden))).toBeNull();
      expect(hidden.mode).toBe("hidden");
    });

    it("leaves every track alone when the page keeps one of them hidden", () => {
      const hidden = makeTrack({ mode: "hidden", language: "fr" });
      const plain = makeTrack({ language: "en" });

      expect(toggleCaptions(makeCaptionedVideo(hidden, plain))).toBeNull();
      expect([hidden.mode, plain.mode]).toEqual(["hidden", "disabled"]);
    });

    it("ignores a hidden track that is not a caption or subtitle track", () => {
      const metadata = makeTrack({ kind: "metadata", mode: "hidden" });
      const plain = makeTrack({ language: "en" });

      expect(toggleCaptions(makeCaptionedVideo(metadata, plain))?.enabled).toBe(true);
      expect([metadata.mode, plain.mode]).toEqual(["hidden", "showing"]);
    });
  });
});

describe("toggleCaptions action", () => {
  it("toggles the target's track and shows the result in the overlay", () => {
    const track = makeTrack({ label: "English", language: "en" });
    const video = makeCaptionedVideo(track);

    handleAction("toggleCaptions", video);
    expect(track.mode).toBe("showing");
    expect(showActionOverlayMock).toHaveBeenLastCalledWith(
      "toggleCaptions",
      video,
      "center",
      expect.anything(),
      expect.objectContaining({ captions: { enabled: true, label: "English" } }),
    );

    handleAction("toggleCaptions", video);
    expect(track.mode).toBe("disabled");
    expect(showActionOverlayMock).toHaveBeenLastCalledWith(
      "toggleCaptions",
      video,
      "center",
      expect.anything(),
      expect.objectContaining({ captions: { enabled: false } }),
    );
  });

  it("does nothing, and shows nothing, for media without a track", () => {
    const video = makeCaptionedVideo();
    state.lastActionedMedia = null;

    handleAction("toggleCaptions", video);

    expect(showActionOverlayMock).not.toHaveBeenCalled();
    // An unrelated media isn't credited as the one the user is controlling.
    expect(state.lastActionedMedia).toBeNull();
  });
});
