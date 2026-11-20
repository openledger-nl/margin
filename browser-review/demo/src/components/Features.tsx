const FEATURES = [
  { icon: '✎', title: 'Write together', text: 'Everyone edits the same note at the same time. Changes show up live.' },
  { icon: '✓', title: 'Decisions stand out', text: 'Mark a line as a decision and it lands on the team page.' },
  { icon: '⏱', title: 'To-dos with dates', text: 'Turn any line into a to-do. Pebble reminds the owner, once.' },
];

export function Features() {
  return (
    <section className="features" id="features">
      <h2>Why teams switch to Pebble</h2>
      <div className="feature-grid">
        {FEATURES.map((f) => (
          <article key={f.title} className="feature">
            <span className="feature-icon" aria-hidden="true">
              {f.icon}
            </span>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
