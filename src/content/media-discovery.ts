function hasNonEmptyAttribute(element: Element, name: string): boolean {
  const value = element.getAttribute(name);
  return typeof value === "string" && value.trim().length > 0;
}

export function isAmbientMediaElement(media: HTMLMediaElement): boolean {
  // If a video doesn't have controls and is muted (or defaults to muted),
  // then it may be an ambient video rather than primary content.
  // TODO: Test with custom video players to ensure this doesn't cause false negatives
  return (
    media instanceof HTMLVideoElement && !media.controls && (media.muted || media.defaultMuted)
  );
}

export function hasValidMediaSource(media: HTMLMediaElement): boolean {
  if (typeof media.currentSrc === "string" && media.currentSrc.trim().length > 0) {
    return true;
  }

  if (hasNonEmptyAttribute(media, "src")) {
    return true;
  }

  if ("srcObject" in media && media.srcObject !== null) {
    return true;
  }

  return Array.from(media.querySelectorAll("source")).some((source) =>
    hasNonEmptyAttribute(source, "src"),
  );
}

export function isTargetableMediaElement(media: HTMLMediaElement): boolean {
  if (isAmbientMediaElement(media)) {
    return false;
  }

  return hasValidMediaSource(media);
}

export function findMedia(root: Document | ShadowRoot | Element): HTMLMediaElement[] {
  const results: HTMLMediaElement[] = [];

  const walker = document.createTreeWalker(
    root instanceof Document ? root.documentElement : root,
    NodeFilter.SHOW_ELEMENT,
  );

  let node: Node | null = walker.currentNode;
  while (node) {
    if (
      (node instanceof HTMLVideoElement || node instanceof HTMLAudioElement) &&
      hasValidMediaSource(node)
    ) {
      results.push(node);
    } else if (node instanceof Element && node.shadowRoot) {
      results.push(...findMedia(node.shadowRoot));
    }
    node = walker.nextNode();
  }

  return results;
}

export function findIframes(root: Document | ShadowRoot | Element): HTMLIFrameElement[] {
  const results: HTMLIFrameElement[] = [];
  const walker = document.createTreeWalker(
    root instanceof Document ? root.documentElement : root,
    NodeFilter.SHOW_ELEMENT,
  );

  let node: Node | null = walker.currentNode;
  while (node) {
    if (node instanceof HTMLIFrameElement) {
      results.push(node);
    } else if (node instanceof Element && node.shadowRoot) {
      results.push(...findIframes(node.shadowRoot));
    }
    node = walker.nextNode();
  }

  return results;
}

export function findIframeWindows(root: Document | ShadowRoot | Element): Window[] {
  return findIframes(root)
    .map((iframe) => iframe.contentWindow)
    .filter((frameWindow): frameWindow is Window => frameWindow !== null);
}

export function collectMediaAndShadowRoots(root: Document | ShadowRoot | Element): {
  media: HTMLMediaElement[];
  shadowRoots: ShadowRoot[];
} {
  const media: HTMLMediaElement[] = [];
  const shadowRoots: ShadowRoot[] = [];

  const walker = document.createTreeWalker(
    root instanceof Document ? root.documentElement : root,
    NodeFilter.SHOW_ELEMENT,
  );

  let node: Node | null = walker.currentNode;
  while (node) {
    if (
      (node instanceof HTMLVideoElement || node instanceof HTMLAudioElement) &&
      hasValidMediaSource(node)
    ) {
      media.push(node);
    } else if (node instanceof Element && node.shadowRoot) {
      shadowRoots.push(node.shadowRoot);
      const nested = collectMediaAndShadowRoots(node.shadowRoot);
      media.push(...nested.media);
      shadowRoots.push(...nested.shadowRoots);
    }
    node = walker.nextNode();
  }

  return { media, shadowRoots };
}
