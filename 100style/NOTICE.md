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
