// Cross-screen form carry (V3-OBS-25 3-screen confirm). A form whose action is
// a `navigate` (obs-entry → obs-confirm) stashes its shaped body + photo here so
// the confirm screen's commit (api action with body_from:"draft") can replay it
// after the full-page navigation. Scalar fields also ride the URL query for
// {{params.*}} display; the photo — which can't live in a query — rides here as
// a data URL, since a File can't be structured-cloned into sessionStorage. Same
// "下書き" idea as V3-BBS-35, kept generic (any confirm screen, not obs-only).

const KEY = "ihl:form-draft";

export type Draft = { body: Record<string, unknown>; file: File | null };

type Stored = {
  body: Record<string, unknown>;
  photo: { name: string; type: string; dataUrl: string } | null;
};

function store(): Storage | null {
  return typeof window !== "undefined" ? window.sessionStorage : null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function saveDraft(body: Record<string, unknown>, file: File | null): Promise<void> {
  const s = store();
  if (!s) return;
  const photo = file
    ? { name: file.name, type: file.type, dataUrl: await blobToDataUrl(file) }
    : null;
  s.setItem(KEY, JSON.stringify({ body, photo } satisfies Stored));
}

export async function loadDraft(): Promise<Draft | null> {
  const s = store();
  const raw = s?.getItem(KEY);
  if (!raw) return null;
  const { body, photo } = JSON.parse(raw) as Stored;
  let file: File | null = null;
  if (photo) {
    const blob = await (await fetch(photo.dataUrl)).blob();
    file = new File([blob], photo.name, { type: photo.type });
  }
  return { body, file };
}

export function clearDraft(): void {
  store()?.removeItem(KEY);
}
