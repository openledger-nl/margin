import { useState } from 'react';

export function Signup() {
  const [sent, setSent] = useState(false);
  return (
    <section className="signup" id="signup">
      <h2>Try Pebble with your team</h2>
      {sent ? (
        <p className="lead">Thanks! Check your inbox.</p>
      ) : (
        <form
          className="signup-form"
          onSubmit={(e) => {
            e.preventDefault();
            setSent(true);
          }}
        >
          <input type="email" required placeholder="you@company.com" aria-label="Work email" />
          <button className="button" type="submit">
            Get started
          </button>
        </form>
      )}
    </section>
  );
}
