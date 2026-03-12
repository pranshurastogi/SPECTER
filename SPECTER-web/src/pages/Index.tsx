import { Header } from "@/components/layout/Header";
import { HomeLayout } from "@/components/layout/HomeLayout";
import { HeroSection } from "@/components/features/landing/HeroSection";
import { TimelineSection } from "@/components/features/landing/TimelineSection";
import { ResumeBanner } from "@/components/features/landing/ResumeBanner";
import { Footer } from "@/components/layout/Footer";

export default function Index() {
  return (
    <HomeLayout>
      <Header />
      <ResumeBanner />
      <main className="flex-1">
        <HeroSection />
        <TimelineSection />
        <Footer />
      </main>
    </HomeLayout>
  );
}
