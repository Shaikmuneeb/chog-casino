import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import GameCards from "@/components/GameCards";
import StatsBar from "@/components/StatsBar";
import Footer from "@/components/Footer";
import ParticlesBg from "@/components/ParticlesBg";

export default function Home() {
  return (
    <div className="min-h-screen bg-casino relative overflow-hidden">
      <ParticlesBg />
      <div className="relative z-10">
        <Navbar />
        <HeroSection />
        <StatsBar />
        <GameCards />
        <Footer />
      </div>
    </div>
  );
}
