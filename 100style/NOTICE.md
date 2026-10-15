# vendor/walk/100style: a captured walk (lab/walk)

- **What:** `Neutral_FW_trim.bvh`, 162 frames (2.7 s at 60 fps) cut from `Neutral_FW.bvh` (Neutral style, forward walk),
  file frames 525 to 686 (0-based, counting from the first line after `Frame Time`). The cut is a loop of two strides whose
  last pose matches its first, taken from a stretch where the actor walks nearly straight (the clip as a whole curves
  steadily). Header and joint hierarchy are unchanged; only the motion lines were dropped.
- **Source:** the 100STYLE dataset, Zenodo record 8127870, doi:10.5281/zenodo.8127870, file `100STYLE.zip`
  (`100STYLE/Neutral/Neutral_FW.bvh`). Only that one member was fetched (HTTP range requests on the zip, 2.4 MB of
  1.47 GB), 2026-10-12.
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0), text in `LICENSE-CC-BY-4.0.txt`
  (https://creativecommons.org/licenses/by/4.0/).
- **Attribution:** Ian Mason, Sebastian Starke, Taku Komura. *100STYLE dataset*, accompanying "Real-Time Style Modelling of
  Human Locomotion via Feature-Wise Transformations and Local Motion Phases", Proceedings of the ACM on Computer Graphics and
  Interactive Techniques 5(1), 2022, doi:10.1145/3522618. Zenodo, doi:10.5281/zenodo.8127870. **Changes made:** trimmed in
  time to the frames above; nothing else. The lab page also removes the actor's travel and heading to show the walk in place
  (done in the page, not in the file).
- **Safety check:** the full file was read as text before trimming: ASCII, a `HIERARCHY` block of `ROOT/JOINT/OFFSET/
  CHANNELS/End Site` lines and a `MOTION` block of numbers only (no non-numeric line). Nothing downloaded was executed.

## Photonic default walker (100style-neutral-v1)

Derived at load/bake time by `src/people/mocap.js` from this unchanged BVH.
Uses trimmed frames 46–126 (original file frames 571–651), successive left
ankle forward extrema as heel-strike proxies, not labelled force-plate contacts.
Changes: periodic endpoint correction/interpolation, heading/travel removal,
per-bone rest alignment onto the 21-bone MakeHuman rig, leg-length/Froude scaling,
±15% shoulder amplitude, slight posture/build offsets, seeded phase, root contact
cleanup, minimal floor-contact leg IK and garment keep-out. These derivatives retain the attribution and
CC BY 4.0 obligations above. Source BVH bytes are unchanged.

## Photonic pace bank (100style-pace-v2)

- **What:** `Neutral_slow.bvh`, 80 frames, original file frames **6038–6117**
  inclusive (0-based). Source member `100STYLE/Neutral/Neutral_FW.bvh`.
  **Changes made:** motion rows outside that range removed and `Frames` updated;
  hierarchy, frame interval and retained numeric rows unchanged.
- **What:** `Rushed_urgent.bvh`, 47 frames, original file frames **2835–2881**
  inclusive (0-based). Source member `100STYLE/Rushed/Rushed_FW.bvh`.
  **Changes made:** motion rows outside that range removed and `Frames` updated;
  hierarchy, frame interval and retained numeric rows unchanged.
- **Source:** 100STYLE.zip, Zenodo record 8127870,
  https://doi.org/10.5281/zenodo.8127870. The lead retrieved these full members
  by ZIP byte ranges on 2026-10-15 and checked ASCII BVH headers/numbers.
- **Licence and attribution:** CC BY 4.0 International; Ian Mason, Sebastian
  Starke and Taku Komura; paper and licence text as credited above.
- **Runtime derivatives:** these cycles and the existing Neutral 571–651 cycle
  undergo heading/travel removal, periodic seam correction, retargeting and
  contact cleanup as described above. Phase-matched affine skin transforms
  blend neighbouring captures. Stride distance and cycle rate change together.
  Only the fast endpoint on under-five rigs uses a timing margin (up to +8%,
  fading to zero at five). No fabricated running/skipping is used.
  Garment openings use padded, quantised body-class corrections, with exact
  refinement for the urgent clip where needed. These derivatives remain
  attributed under CC BY 4.0.

Only the two new trims are added: **95,381 bytes uncompressed**. Full source
walks, runs, Old, Skip and BigSteps are not redistributed by this change.
