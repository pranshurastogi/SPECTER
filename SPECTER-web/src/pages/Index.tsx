import { Header } from "@/components/layout/Header";
import { HomeLayout } from "@/components/layout/HomeLayout";
import { HeroSection } from "@/components/landing/HeroSection";
import { TimelineSection } from "@/components/landing/TimelineSection";
import { Footer } from "@/components/landing/Footer";

export default function Index() {
  return (
    <HomeLayout>
      <Header />
      <main className="flex-1">
        <HeroSection />
        <TimelineSection />
        <Footer />
      </main>
    </HomeLayout>
  );
}
