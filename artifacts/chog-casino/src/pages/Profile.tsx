import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { ArrowLeft, Twitter, CheckCircle2, LogOut, Loader2, Wallet, Camera, Check } from "lucide-react";
import ConnectButton from "@/components/ConnectButton";
import { useWallet } from "@/hooks/useWallet";
import ParticlesBg from "@/components/ParticlesBg";
import GameModeToggle from "@/components/GameModeToggle";
import avatarImage from "@assets/chog_heads_side_1781813831765.png";
import { useSocialConnection } from "@/hooks/useSocialConnection";
import { PROVIDER_LABELS, type Provider } from "@/lib/socialAuth";
import { useProfile } from "@/hooks/useProfile";
import { fileToResizedDataUrl, USERNAME_MAX_LENGTH } from "@/lib/profile";

interface SocialOption {
  provider: Provider;
  label: string;
  description: string;
  icon: typeof Twitter;
  iconColor: string;
  ring: string;
}

const SOCIALS: SocialOption[] = [
  {
    provider: "x",
    label: "Connect X (Twitter)",
    description: "Link your X account to your Chog profile.",
    icon: Twitter,
    iconColor: "text-blue-400",
    ring: "hover:border-blue-400/50 hover:shadow-[0_0_24px_rgba(96,165,250,0.25)]",
  },
];

export default function Profile() {
  const [, setLocation] = useLocation();
  const { connected: walletConnected } = useWallet();
  const { connection, connecting, connectX, disconnect } = useSocialConnection();
  const { avatar, username, saveAvatar, saveUsername } = useProfile();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [nameDraft, setNameDraft] = useState(username);
  const [nameSaved, setNameSaved] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const displayAvatar = avatar ?? avatarImage;

  const handleAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setAvatarError(null);
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      saveAvatar(dataUrl);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Could not set that image.");
    }
  };

  const handleSaveUsername = () => {
    saveUsername(nameDraft.trim());
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 1800);
  };

  const usernameDirty = nameDraft.trim() !== username;

  const handleConnect = (provider: Provider) => {
    if (provider === "x") connectX();
  };

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ backgroundColor: "hsl(270,40%,4%)" }}>
      <ParticlesBg />
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-4 sm:px-8 py-6">
          <motion.button
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
            whileHover={{ scale: 1.05, x: -2 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setLocation("/")}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl glass border border-purple-500/30 text-purple-200 hover:text-yellow-300 hover:border-yellow-400/40 transition-colors duration-200 text-sm font-medium tracking-wide"
            data-testid="button-back-home"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Lobby
          </motion.button>

          <div className="hidden sm:block">
            <GameModeToggle />
          </div>

          <ConnectButton />
        </header>

        {/* Content */}
        <div className="flex-1 px-4 sm:px-8 pb-12">
          <div className="max-w-2xl mx-auto">
            {/* Title */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="text-center mb-8"
            >
              <h1 className="font-cinzel font-black text-3xl sm:text-4xl tracking-widest text-white mb-1">
                My <span className="gradient-purple-gold">Profile</span>
              </h1>
              <p className="text-purple-300/50 tracking-widest text-xs uppercase">
                Customize how you appear in Chog Casino
              </p>
            </motion.div>

            {/* Profile info */}
            <div className="text-[10px] text-purple-300/50 tracking-widest uppercase mb-1 px-1">
              Profile Info
            </div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="glass rounded-2xl border border-purple-500/20 p-6 mb-6 flex flex-col items-center"
              data-testid="profile-info-card"
            >
              {/* Editable avatar */}
              <div className="relative w-28 h-28 mb-3">
                <div className="w-full h-full rounded-full overflow-hidden border-2 border-purple-400/50 neon-purple">
                  <img
                    src={displayAvatar}
                    alt="Avatar"
                    className="w-full h-full object-cover"
                    data-testid="profile-avatar-preview"
                  />
                </div>
                {connection && (
                  <CheckCircle2 className="absolute top-0 right-0 w-6 h-6 text-green-400 bg-[#150c28] rounded-full p-0.5" />
                )}
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-gradient-to-br from-purple-600 to-purple-800 border-2 border-[#150c28] flex items-center justify-center text-white shadow-lg neon-purple"
                  aria-label="Change avatar"
                  data-testid="button-edit-avatar"
                >
                  <Camera className="w-4 h-4" />
                </motion.button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarPick}
                  className="hidden"
                  data-testid="input-avatar-file"
                />
              </div>

              {avatarError && (
                <p className="text-xs text-red-400 mb-1" data-testid="avatar-error">{avatarError}</p>
              )}

              {/* Username */}
              <div className="w-full max-w-sm mt-4">
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="username" className="text-xs text-purple-300/70 tracking-widest uppercase">
                    Username
                  </label>
                  <span className="text-[10px] text-purple-300/40 tabular-nums" data-testid="username-counter">
                    {nameDraft.length}/{USERNAME_MAX_LENGTH}
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    id="username"
                    type="text"
                    value={nameDraft}
                    maxLength={USERNAME_MAX_LENGTH}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && usernameDirty) handleSaveUsername(); }}
                    placeholder="Enter your username"
                    className="flex-1 min-w-0 px-4 py-2.5 rounded-xl bg-[#0a0618]/60 border border-purple-500/30 text-sm text-white placeholder:text-purple-300/30 outline-none focus:border-purple-400/60 transition-colors"
                    data-testid="input-username"
                  />
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={handleSaveUsername}
                    disabled={!usernameDirty && !nameSaved}
                    className={`px-4 py-2.5 rounded-xl text-sm font-semibold tracking-wide flex items-center gap-1.5 transition-all border ${
                      nameSaved
                        ? "bg-green-500/15 border-green-400/40 text-green-300"
                        : "bg-gradient-to-r from-purple-600 to-purple-800 border-purple-400/30 text-white neon-purple disabled:opacity-40"
                    }`}
                    data-testid="button-save-username"
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {nameSaved ? (
                        <motion.span key="saved" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5">
                          <Check className="w-4 h-4" /> Saved
                        </motion.span>
                      ) : (
                        <motion.span key="save" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                          Save
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>
                </div>
              </div>
            </motion.div>

            {/* Connected banner */}
            {connection && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass rounded-2xl border border-green-500/30 bg-green-500/5 p-5 mb-6 flex items-center justify-between"
                data-testid="profile-connected-banner"
              >
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-6 h-6 text-green-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-white text-sm">
                      Connected via {PROVIDER_LABELS[connection.provider]}
                    </p>
                    <p className="text-purple-300/60 text-xs">
                      Authorized on {new Date(connection.connectedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <button
                  onClick={disconnect}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-red-300 hover:text-red-200 hover:bg-red-500/10 border border-red-500/30 transition-colors"
                  data-testid="button-disconnect-social"
                >
                  <LogOut className="w-4 h-4" />
                  Disconnect
                </button>
              </motion.div>
            )}

            {/* Connect options */}
            <div className="space-y-3">
              <div className="text-[10px] text-purple-300/50 tracking-widest uppercase mb-1 px-1">
                Social Accounts
              </div>
              {SOCIALS.map((social, i) => {
                const Icon = social.icon;
                const isThisConnected = connection?.provider === social.provider;
                const isBusy = connecting === social.provider;
                return (
                  <motion.button
                    key={social.provider}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.1 + i * 0.08 }}
                    whileHover={!isThisConnected ? { scale: 1.01 } : {}}
                    whileTap={!isThisConnected ? { scale: 0.99 } : {}}
                    onClick={() => !isThisConnected && !connecting && handleConnect(social.provider)}
                    disabled={isThisConnected || connecting !== null}
                    className={`w-full flex items-center gap-4 p-5 rounded-2xl glass border text-left transition-all duration-200 ${
                      isThisConnected
                        ? "border-green-500/40 bg-green-500/5 cursor-default"
                        : `border-purple-500/20 ${social.ring} disabled:opacity-50`
                    }`}
                    data-testid={`profile-connect-${social.provider}`}
                  >
                    <div className="w-11 h-11 rounded-xl glass border border-white/10 flex items-center justify-center shrink-0">
                      {isBusy ? (
                        <Loader2 className={`w-5 h-5 ${social.iconColor} animate-spin`} />
                      ) : (
                        <Icon className={`w-5 h-5 ${social.iconColor}`} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white text-sm">
                        {isThisConnected ? `${PROVIDER_LABELS[social.provider]} connected` : social.label}
                      </p>
                      <p className="text-purple-300/50 text-xs truncate">
                        {isThisConnected ? "You're all set." : social.description}
                      </p>
                    </div>
                    {isThisConnected && <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />}
                  </motion.button>
                );
              })}
            </div>

            {/* Wallet status */}
            <div className="mt-8">
              <div className="text-[10px] text-purple-300/50 tracking-widest uppercase mb-1 px-1">Wallet</div>
              <div className="glass rounded-2xl border border-purple-500/20 p-5 flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl glass border border-white/10 flex items-center justify-center shrink-0">
                  <Wallet className="w-5 h-5 text-yellow-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white text-sm">
                    {walletConnected ? "Wallet connected" : "No wallet connected"}
                  </p>
                  <p className="text-purple-300/50 text-xs">
                    {walletConnected ? "Ready to place $CHOG bets." : "Use “Connect Wallet” above to start playing."}
                  </p>
                </div>
                {walletConnected && <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
