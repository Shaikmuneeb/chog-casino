import { useEffect, useState } from "react";
import {
  PROFILE_CHANGED_EVENT,
  getStoredAvatar,
  setStoredAvatar,
  clearStoredAvatar,
  getStoredUsername,
  setStoredUsername,
} from "@/lib/profile";

export function useProfile() {
  const [avatar, setAvatarState] = useState<string | null>(() => getStoredAvatar());
  const [username, setUsernameState] = useState<string>(() => getStoredUsername());

  useEffect(() => {
    const sync = () => {
      setAvatarState(getStoredAvatar());
      setUsernameState(getStoredUsername());
    };
    window.addEventListener(PROFILE_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(PROFILE_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const saveAvatar = (dataUrl: string) => setStoredAvatar(dataUrl);
  const resetAvatar = () => clearStoredAvatar();
  const saveUsername = (name: string) => setStoredUsername(name);

  return { avatar, username, saveAvatar, resetAvatar, saveUsername };
}
