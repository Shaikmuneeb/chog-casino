import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import ParticlesBg from "@/components/ParticlesBg";

export default function Home() {
  return (
    <div className="min-h-screen relative overflow-hidden" style={{ backgroundColor: "hsl(270,40%,4%)" }}>
      <ParticlesBg />
      <div className="relative z-10">
        <Navbar />
        <HeroSection />
      </div>
    </div>
  );
}
