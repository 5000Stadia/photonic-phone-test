# MakeHuman community hair, used by Photonic's hairstyle lineup (R5)

Six hairstyles from MakeHuman's own asset packs, data only (`.mhclo` fit data, `.obj` shells, `.mhmat` materials, a diffuse atlas shrunk to 1024 px).
No scripts, no code. Fetched 2026-10-13 by `tools/mh/hair-pack.py fetch` (HTTP range requests into each zip; only the named members, data extensions only),
from https://files.makehumancommunity.org/asset_packs/ . The packer is ours; the fitted, packed form is in `spikes/mhhair/data/`.

| Style (id) | Asset | Pack | Licence | Author | Source |
|---|---|---|---|---|---|
| bob | `toigo_inverted_bob_with_bangs` | hair01 | CC0 | Margaret Toigo | http://www.makehumancommunity.org/node/1685 |
| long | `elvs_hazel_hair` | hair02 | **CC BY** | Elvaerwyn | http://www.makehumancommunity.org/node/2816 |
| crop | `short04` | makehuman_system_assets | CC0 | MakeHuman system assets (Data Collection AB, Joel Palmius, Jonas Hauquier) | http://www.makehumancommunity.org |
| braid | `braid01` | makehuman_system_assets | CC0 | MakeHuman system assets | http://www.makehumancommunity.org |
| afro | `afro01` | makehuman_system_assets | CC0 | MakeHuman system assets | http://www.makehumancommunity.org |
| updo | `elvs_50s_updo` | hair02 | **CC BY** | Elvaerwyn | http://www.makehumancommunity.org/node/2001 |

Licence evidence: each pack's `packs/<pack>.json` lists the licence per asset; the system assets' own `.mhclo`/`.mhmat` headers say "explicitly released as CC0 in
september 2020"; the Toigo `.mhclo` says `license CC0`; the two Elvaerwyn `.mhclo` say `CC-BY` / `CC_by`. CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ .
CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/ (text in `../makehuman/LICENSE.ASSETS.md`).

## Credit required (CC BY)

"Elvaerwyn's Hair 02 (Hazel; 1950s updo)", by Elvaerwyn, from the MakeHuman community asset library (hair02 pack), licensed CC BY. **Changed:** the
hair is fitted to each person's body at run time (the shell's vertices are moved with the person), triangulated, and its painted texture is reduced
to a 1024 px greyscale strand atlas (the original colours are not kept; the person's hair colour is applied instead). Wherever the lineup page
shows these two styles it labels them with the author and licence.

## Changes made to every asset

Texture shrunk to 1024 px (premultiplied-alpha resampling, metadata chunks dropped), then turned into a strand atlas (R coverage, G painted tone, B strand detail).
Mesh and fit data are unchanged apart from packing (quads to triangles, vertex/UV expansion, a per-vertex root-to-tip value computed on the neutral base).
The original normal, specular and thumbnail files are not included.

## Not used, and why

- `rehmanpolanski_hair_bun_brown` (hair01, listed CC0 in the pack's json): its `.mhclo` header says `license AGPL3` (a MakeClothes default), contradicting the pack's CC0 label. Replaced by the Elvaerwyn updo.
- `elvs_french_braid_variation` (hair01): same header contradiction (`license AGPL3`, author "Unknown"); the system `braid01` it is a reworking of is used instead.
