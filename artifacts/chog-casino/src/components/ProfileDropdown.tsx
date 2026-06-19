import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { UserRound, CheckCircle2 } from "lucide-react";
import avatarImage from "@assets/chog_heads_side_1781813831765.png";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSocialConnection } from "@/hooks/useSocialConnection";
import { PROVIDER_LABELS } from "@/lib/socialAuth";
import { useProfile } from "@/hooks/useProfile";

export default function ProfileDropdown() {
  const [, setLocation] = useLocation();
  const { connection } = useSocialConnection();
  const { avatar } = useProfile();
  const displayAvatar = avatar ?? avatarImage;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <motion.button
          className="flex items-center gap-3 cursor-pointer select-none outline-none"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.96 }}
          data-testid="button-profile"
        >
          <div className="relative w-11 h-11 rounded-full overflow-hidden border-2 border-purple-400/50 neon-purple shrink-0">
            <img
              src={displayAvatar}
              alt="Profile"
              className="w-full h-full object-cover"
              data-testid="profile-avatar-image"
            />
            {connection && (
              <CheckCircle2 className="absolute -bottom-0.5 -right-0.5 w-4 h-4 text-green-400 bg-[#150c28] rounded-full" />
            )}
          </div>
        </motion.button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-60 glass border border-purple-500/30 bg-[#150c28]/95 backdrop-blur-xl text-purple-100 rounded-2xl p-1.5"
        data-testid="profile-dropdown-menu"
      >
        {connection ? (
          <div className="flex items-center gap-3 px-3 pt-2.5 pb-3" data-testid="profile-connected-header">
            <div className="relative">
              <img
                src={displayAvatar}
                alt=""
                className="w-11 h-11 rounded-full border border-purple-400/40 object-cover"
              />
              <CheckCircle2 className="absolute -bottom-0.5 -right-0.5 w-4 h-4 text-green-400 bg-[#150c28] rounded-full" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm text-white truncate">Connected</p>
              <p className="text-purple-300/70 text-xs truncate">via {PROVIDER_LABELS[connection.provider]}</p>
            </div>
          </div>
        ) : (
          <DropdownMenuLabel className="font-cinzel text-xs tracking-widest text-purple-300/60 uppercase px-3 pt-2 pb-1">
            My Profile
          </DropdownMenuLabel>
        )}
        <DropdownMenuSeparator className="bg-purple-500/15" />

        <DropdownMenuItem
          onSelect={() => setLocation("/profile")}
          className="gap-2.5 rounded-xl px-3 py-2.5 text-sm text-purple-100 focus:bg-purple-500/15 focus:text-white cursor-pointer"
          data-testid="menu-item-view-profile"
        >
          <UserRound className="w-4 h-4 text-purple-300" />
          View Profile
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
