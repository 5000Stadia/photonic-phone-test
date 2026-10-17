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

## Photonic standing idle (neutral-idle-v1)

- **What:** `Neutral_idle.bvh`, 206 frames at 30 fps (6.83 s), a seamless standing loop cut from
  `100STYLE/Neutral/Neutral_ID.bvh` (Neutral style, idle), original file frames **707 to 1117**
  inclusive (0-based, counting from the first line after `Frame Time`), every second frame kept.
  The cut lies inside the dataset's published idle range for Neutral (`Frame_Cuts.csv`: ID 655–1555).
  It was chosen as the 4–7 s span whose two ends match best (windowed joint-position and velocity
  distance over the cut; 3 mm RMS between the ends); the feet do not move in it.
- **Changes made:** motion rows outside that range and every other row removed, `Frames` and
  `Frame Time` updated (0.033333), numbers rounded to four decimals. Hierarchy unchanged.
- **Source:** 100STYLE.zip, Zenodo record 8127870, https://doi.org/10.5281/zenodo.8127870, member
  `100STYLE/Neutral/Neutral_ID.bvh`, supplied by the lead 2026-10-15 (byte-range retrieval) and
  checked as ASCII BVH: a `HIERARCHY` block and numeric motion rows only. Nothing downloaded was executed.
- **Licence and attribution:** CC BY 4.0 International; Ian Mason, Sebastian Starke and Taku Komura;
  paper and licence text as credited above.
- **Runtime derivatives** (`src/people/mocap.js`): the loop's mean pose is the retarget reference for
  every 100STYLE clip (rotations are matched against the captured person's own standing, not the
  skeleton's T-pose); the loop itself is retargeted onto each body with both feet planted by leg IK,
  pelvis sway and height scaled by standing hip height, and baked per person. Walk-to-stand and
  stand-to-walk are short blends between captured poses (`src/people/motion.js`), not captured clips.
  These derivatives retain the attribution and CC BY 4.0 obligations above.

## Photonic captured moves (neutral-moves-v1)

A start from standing, a stop out of the walk, and the about-turn before sitting, each cut to exactly the
frames that play (`src/people/moves.js`). Every second frame kept (30 fps), `Frames` and `Frame Time` updated
(0.033334), numbers rounded to four decimals; hierarchy unchanged. Frame numbers are 0-based, counting from the
first line after `Frame Time`.

- **What:** `Neutral_start.bvh`, 66 frames (2.17 s), from `100STYLE/Neutral/Neutral_ID.bvh` (Neutral style,
  idle), original file frames **1714 to 1844** inclusive: the actor standing, then setting off (the weight onto
  the right foot, the left foot first) into the walk. Outside the dataset's published idle cut for Neutral
  (`Frame_Cuts.csv`: ID 655–1555), where the take's end walks off.
- **What:** `Neutral_stop.bvh`, 53 frames (1.73 s), from `100STYLE/Neutral/Neutral_FW.bvh` (forward walk),
  original file frames **5820 to 5924** inclusive: the walk, two shortening steps, the feet closing; a stop in
  the middle of the trial (the stops at the ends of the idle take carry gestures: the head down, a hand forward).
- **What:** `Neutral_turn.bvh`, 77 frames (2.53 s), from `100STYLE/Neutral/Neutral_ID.bvh`, original file
  frames **128 to 280** inclusive: the walk in, slowing, an about-turn of 188 degrees on two pivot steps, two
  settling steps, standing facing back. Outside the published idle cut, at the take's start.
- **Source:** 100STYLE.zip, Zenodo record 8127870, https://doi.org/10.5281/zenodo.8127870, the members above as
  supplied by the lead (byte-range retrieval, 2026-10-15/16). Before cutting, each whole member was checked as
  text: a `HIERARCHY` block of `ROOT/JOINT/OFFSET/CHANNELS/End Site` lines and a motion block of numbers only.
  Nothing downloaded was executed. The dataset's turn takes (`Neutral_TR1`..) were looked at and not used: they
  turn between gaits without stopping.
- **Licence and attribution:** CC BY 4.0 International; Ian Mason, Sebastian Starke and Taku Komura; paper and
  licence text as credited above.
- **Runtime derivatives** (`src/people/moves.js`): retargeted onto each body as the walk is (the idle loop's mean
  pose as the shared reference; pelvis height scaled by hip height); mirrored left for right where the other foot
  or the other way round is needed; the travel re-laid so the move ends where it is sent (the distance scaled, 0.6
  to 1.45 of the capture over the last steps, with a few centimetres spread over them; a turn added or taken away:
  a start turned toward its way, a stop or the about-turn ended facing a seat), the planted feet held by leg IK
  where they land (a foot turned past 25 degrees pivots on its ball); the arms replaced by the idle loop's where the actor folds
  his (before the start, after the turn); blended with the walk cycle over a quarter second where they meet. These
  derivatives retain the attribution and CC BY 4.0 obligations above.

The three trims add **118,505 bytes uncompressed**.
