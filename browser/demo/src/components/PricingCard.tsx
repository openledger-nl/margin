interface Props {
  name: string;
  price: string;
  per: string;
  features: string[];
  popular?: boolean;
}

export function PricingCard({ name, price, per, features, popular }: Props) {
  return (
    <article className={`plan ${popular ? 'is-popular' : ''}`}>
      {popular && <span className="plan-badge">Most popular</span>}
      <h2>{name}</h2>
      <p className="plan-price">
        {price} <span>{per}</span>
      </p>
      <ul>
        {features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <a className="button" href="#signup">
        Choose {name}
      </a>
    </article>
  );
}
