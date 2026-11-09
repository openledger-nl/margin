// Pebble, a made-up product, as a demo app for Browser Review. It has a few
// things worth a review comment on purpose; see the list in demo/README.md.
import { Banner } from './components/Banner.tsx';
import { Features } from './components/Features.tsx';
import { Footer } from './components/Footer.tsx';
import { Header } from './components/Header.tsx';
import { Hero } from './components/Hero.tsx';
import { Pricing } from './components/Pricing.tsx';
import { Signup } from './components/Signup.tsx';
import { usePath } from './router.ts';

export function App() {
  const path = usePath();
  return (
    <>
      <Banner />
      <Header path={path} />
      <main>
        {path === '/pricing' ? (
          <Pricing />
        ) : (
          <>
            <Hero />
            <Features />
            <Signup />
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
