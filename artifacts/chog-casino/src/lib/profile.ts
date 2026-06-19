const AVATAR_KEY = "chog_profile_avatar";
const USERNAME_KEY = "chog_profile_username";

export const USERNAME_MAX_LENGTH = 20;

/** Fired whenever the profile changes in this tab — `storage` only fires in *other* tabs. */
export const PROFILE_CHANGED_EVENT = "chog-profile-changed";

function emitChanged(): void {
  window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
}

export function getStoredAvatar(): string | null {
  return localStorage.getItem(AVATAR_KEY);
}

export function setStoredAvatar(dataUrl: string): void {
  localStorage.setItem(AVATAR_KEY, dataUrl);
  emitChanged();
}

export function clearStoredAvatar(): void {
  localStorage.removeItem(AVATAR_KEY);
  emitChanged();
}

export function getStoredUsername(): string {
  return localStorage.getItem(USERNAME_KEY) ?? "";
}

export function setStoredUsername(name: string): void {
  localStorage.setItem(USERNAME_KEY, name.slice(0, USERNAME_MAX_LENGTH));
  emitChanged();
}

/**
 * Reads an image File, downscales it to `maxSize` px on its longest edge via canvas,
 * and returns a compressed data URL. Downscaling is essential — a raw photo as base64
 * easily exceeds localStorage's ~5MB quota and would throw QuotaExceededError.
 */
export function fileToResizedDataUrl(file: File, maxSize = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That image could not be loaded."));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Image processing is not supported in this browser."));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        // JPEG keeps the stored string small; transparency isn't needed for avatars.
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
