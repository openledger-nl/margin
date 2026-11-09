import { navigate } from '../router.ts';

const LINKS = [
  { to: '/', label: 'Product' },
  { to: '/pricing', label: 'Pricing' },
];

export function Header({ path }: { path: string }) {
  return (
    <header className="header">
      <a
        className="logo"
        href="/"
        onClick={(e) => {
          e.preventDefault();
          navigate('/');
        }}
      >
        <span className="logo-mark" aria-hidden="true" />
        Pebble
      </a>
      <nav className="nav">
        {LINKS.map((l) => (
          <a
            key={l.to}
            href={l.to}
            className={path === l.to ? 'is-active' : ''}
            onClick={(e) => {
              e.preventDefault();
              navigate(l.to);
            }}
          >
            {l.label}
          </a>
        ))}
        <a className="button button-small" href="#signup">
          Sign in
        </a>
      </nav>
    </header>
  );
}
