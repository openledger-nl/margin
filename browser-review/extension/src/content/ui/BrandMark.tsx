// The company's logo on the customer side (brand.json on the hub), else the Margin mark.
import { useHost } from '../host.ts';
import { Mark } from './Mark.tsx';

export function BrandMark() {
  const logo = useHost().brand?.logo;
  return logo ? <img class="brm-mark brm-logo" src={logo} alt="" /> : <Mark />;
}
