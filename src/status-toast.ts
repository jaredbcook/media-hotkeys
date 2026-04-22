export type StatusToastTone = "success" | "error";

const STATUS_TOAST_VISIBLE_MS = 3000;
const STATUS_TOAST_EXIT_MS = 240;

const activeToasts = new WeakMap<HTMLElement, HTMLDivElement>();
const toastTimeouts = new WeakMap<HTMLDivElement, number>();

function dismissStatusToast(toast: HTMLDivElement, container?: HTMLElement): void {
  const timeoutId = toastTimeouts.get(toast);
  if (timeoutId !== undefined) {
    window.clearTimeout(timeoutId);
    toastTimeouts.delete(toast);
  }

  if (container && activeToasts.get(container) === toast) {
    activeToasts.delete(container);
  }

  if (toast.classList.contains("announcement-exiting")) {
    return;
  }

  toast.classList.remove("announcement-visible");
  toast.classList.add("announcement-exiting");

  window.setTimeout(() => {
    toast.remove();
  }, STATUS_TOAST_EXIT_MS);
}

export function showStatusToast(
  message: string,
  tone: StatusToastTone,
  options?: {
    container?: HTMLElement | null;
    liveRegion?: HTMLElement | null;
  },
): void {
  const container = options?.container ?? document.getElementById("announcements");
  if (!container) {
    return;
  }

  const activeToast = activeToasts.get(container);
  if (activeToast) {
    dismissStatusToast(activeToast, container);
  }

  const toast = document.createElement("div");
  toast.className = `announcement announcement-${tone}`;
  toast.setAttribute("role", tone === "error" ? "alert" : "status");
  toast.setAttribute("aria-atomic", "true");

  const content = document.createElement("div");
  content.className = "announcement-content";
  content.textContent = message;
  toast.appendChild(content);

  container.appendChild(toast);
  activeToasts.set(container, toast);
  if (options?.liveRegion) {
    options.liveRegion.textContent = message;
  }

  window.requestAnimationFrame(() => {
    toast.classList.add("announcement-visible");
  });

  toastTimeouts.set(
    toast,
    window.setTimeout(() => {
      dismissStatusToast(toast, container);
    }, STATUS_TOAST_VISIBLE_MS),
  );
}
