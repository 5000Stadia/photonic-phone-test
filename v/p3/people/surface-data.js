import { PACKAGE_KINDS, SILKS } from './garments/kinds.js';
const FABRIC = { linen: 0, lace: 0, wool: 1, velvet: 2, silk: 3, satin: 3, leather: 4 };
const WEAR = { new: 0, good: 0.1, worn: 0.45, patched: 0.65, ragged: 0.9 };
/** Render-only data; never change attire, colours or the deterministic garment report. */
export function surfaceData(dressing, attire) {
  const { outfit, look } = dressing, p = PACKAGE_KINDS[outfit.id];
  const palette = SILKS[outfit.id]?.find(x => x.id === look.id);
  const working = outfit.id.startsWith('work');
  const encode = (part, kind, fallback) => {
    const drawn = attire.drawn.find(g => g.as === kind || (part === 'lower' && g.as === 'plain_skirt'));
    const g = attire.garments.find(g => g.id === drawn?.id);
    const aspects = g?.aspects ?? {};
    const material = aspects.material ?? (typeof look.material === 'string' ? look.material : look.material?.[part]) ?? palette?.[part]?.[1] ?? fallback;
    const wear = WEAR[aspects.condition] ?? (working ? 0.45 : 0.1);
    return (FABRIC[material] ?? 1) + wear * 0.1;
  };
  return [encode('upper', p.torso, 'wool'), encode('lower', p.legs, 'wool')];
}
