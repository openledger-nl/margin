import { PricingCard } from './PricingCard.tsx';

export function Pricing() {
  return (
    <section className="pricing">
      <h1>Simple pricing</h1>
      <p className="lead">Free for small teams. Pay when you grow.</p>
      <div className="pricing-grid">
        <PricingCard name="Starter" price="€0" per="for up to 3 people" features={['Unlimited notes', 'Decisions', '7 days of history']} />
        <PricingCard name="Team" price="€6" per="per person per month" features={['Everything in Starter', 'To-dos with reminders', 'Full history']} />
        <PricingCard name="Business" price="€12" per="per person per month" features={['Everything in Team', 'Single sign-on', 'Priority support']} popular />
      </div>
    </section>
  );
}
