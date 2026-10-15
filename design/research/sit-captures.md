# CMU sitting captures — part 1, 2026-10-15

Review lab: [lab/sit/index.html](../../lab/sit/index.html). This is a raw capture
study, not an animation bank approved for the crowd. No `sit(thing)` / `stand()`
implementation, seat schema, clothing adaptation or gait connection is included.

## Provenance and performer metadata

The lead supplied original CMU ASCII ASF/AMC files in
`~/.cache/photonic-scratch/cmu-raw/`. Source URLs, exact retained ranges, modifications,
CMU terms text and NSF credit are in [NOTICE](../../vendor/sit/cmu/NOTICE.md).
These are not the previously proposed Hahne BVHs; there is no synthetic T-pose.

[CMU's subject list](https://mocap.cs.cmu.edu/subjects.php) calls subject 113
“Post pregnant woman.” The original `113_15.amc` header points to
`H:\Not Pregnant\Project 1\Capture day 1\Session 1\non-pregnant.ASF`.
Record this as a woman in the non-pregnant session; build, age, mass and exact
postpartum timing are not supplied. Do not infer a pregnant body from this take.
[Subject 13](https://mocap.cs.cmu.edu/search.php?subjectnumber=13) is described only
as “various everyday behaviors”; sex and build are unspecified. No body appearance
is inferred from skeleton dimensions. Indexed primary CMU pages were checked;
direct subject/FAQ fetches failed in this session.

## Frame convention and selected sequence

All numbers below are **original AMC frame labels, inclusive, 120 Hz**. They are
not zero-based row indices. ASF `length 0.45` means .45 length units per inch:
metres = units × .0254 / .45. Angular channels are degrees. The complete originals
contain 953, 4403 and 2313 frames respectively.

| Capture | Approach / turn | Sit-down | Seated (includes preparation to rise) | Stand-up | Departure context | Vendored |
| --- | --- | --- | --- | --- | --- | --- |
| 113_15 chair | 31–150 | 151–330 | 331–570 | 571–719 | 720–800 | 31–800 |
| 13_05 stepstool | 31–230 | 231–360 | 361–1270 | 1271–1360 | 1361–1450 | 31–1450 |
| 13_01 high stool | 31–360 | 361–580 | 581–910 | 911–990 | 991–1100 | 31–1100 |

Cuts were marked from pelvis position/descent/plateau and foot height/velocity
traces sampled every 30 frames, then checked against per-frame contact runs.
Approach/turn is one combined review interval, not a claim that every frame is a
step or turn. Sit-down begins after the final approach step; its end includes
settling onto the pelvis plateau. Stand-up begins at the sustained pelvis rise
(weight-off proxy), ending at departure foot release. These are **kinematic
estimates, approximately ±30 frames (0.25 s)**, not measured seat loading events.
In particular, settling, trunk lean and foot repositioning can occur while still
weight-bearing on the seat. The lab supports original-frame scrubbing for Kabe to
refine these cuts. No browser or human visual judgment was used to certify them.

The stable seated measurement windows are 390–500, 650–1100 and 620–830.
The whole seated review interval retains fidgeting and rise preparation; none is
made into a loop. The lab plays forward once and stops; Replay visibly resets.

### Other repetitions in the originals (not vendored)

- **13_05 second sit:** approach/turn 1451–1850, sit 1851–2040,
  seated 2041–2890, rise 2891–3020. Both feet remain near the floor during most
  of this seated interval. Third approach/turn 3021–3420, sit 3421–3600,
  seated 3601–4403; the recording ends seated, so no third stand-up is present.
- **13_01 second sit:** approach/turn 1101–1450, sit 1451–1620,
  seated 1621–2170, rise 2171–2260, departure 2261–2313. In this repetition
  both feet lift while seated. The selected first repetition keeps them low.
- **113_15:** one complete sit/rise. Frames 1–30 are initial context;
  801–953 continue the departure. Initial 1–30 context is also omitted from
  both subject-13 cuts. Later repetition boundaries are coarse trace annotations,
  not lab-reviewed selections, and can be reproduced only with the cached originals.

## Reader and retarget

`spikes/gait/asf-amc.js` explicitly supports fully specified, degree AMC files;
it rejects sparse/radian motion, missing/duplicate channels, nonconsecutive frame
labels, malformed numbers and disconnected/cyclic hierarchies. It respects root
channel order, static bones, ASF axis frames and declared units. Column-vector
rotations in XYZ order are Rz Ry Rx; each bone uses C M C⁻¹. ASF bone positions
are endpoints: child heads start at parent endpoints. The reader exposes both P
(head) and E (endpoint), preventing the BVH one-bone positional offset mistake.

`src/people/sit-mocap.js` uses an explicit 21-bone map like the walk retargeter.
Root → hips, lowerback → spine, thorax → chest, lowerneck → neck, head → head;
clavicle/humerus/radius/hand → clavicle/upperarm/forearm/hand;
femur/tibia/foot/toes → thigh/shin/foot/toe, on each side. Source intermediate
spine, neck, wrist and hip bones remain in FK, so their rotations reach descendants.
Each rig child direction aligns to the mapped ASF rest bone direction; terminal
frames now align their own explicit head/hand/toe tip vectors. Source femur+tibia length scales root
translations to the rig's thigh+shin length. Rig bone lengths remain exact.

There is one fixed horizontal origin at the seated pelvis and one fixed estimated
floor translation per clip. The lab camera rotates the entire view to the seated
root heading. Captured turns and travel remain intact; the camera does not follow
the pelvis. No periodic detrending, speed warping, posture gains, IK, foot locks,
seat snapping, synthetic transitions or smoothing are applied. Fractional samples
interpolate original channels using the shortest angular delta, then redo FK.
The pale overlay shows the source skeleton at the nearest original sample,
scaled by the same leg ratio.

## Seat height and retarget quality

A pelvis joint is above a physical seat surface by an unknown soft-tissue/body
geometry offset. The following numbers are **pelvis-derived seat proxies**, not
furniture dimensions. The reference plane in the lab is intentionally labelled
as a pelvis plane. A physical hip-to-seat error cannot be determined from these
files without a seat model or markers.

| Capture | Source pelvis proxy | Mean rig proxy | Retarget scale | Source planted-foot excursion L / R | Rig excursion L / R | Rig seated pelvis peak deviation |
| --- | --- | --- | --- | --- | --- | --- |
| 113_15 | .51518 m | .45629 m | .88569 | 1.46 / 2.10 cm | 4.90 / 5.33 cm | .170 cm |
| 13_05 | .51941 m | .41142 m | .79209 | 2.60 / 1.23 cm | 5.90 / 2.48 cm | .361 cm |
| 13_01 | .84279 m | .66757 m | .79209 | 3.19 / 2.64 cm | 2.76 / 4.59 cm | .093 cm |

Hip height error relative to the scaled captured pelvis is **0 m by construction**
(root translation is preserved), not evidence of a correct physical seat fit.
Seated peak deviation is measured from the median in the stable windows above.
These are measurements for the mean 1.72 m procedural rig, not a demographic cast
sweep. Retargeted standing/turning foot drift is visible and remains uncorrected;
this is suitable for judging capture choice, not yet a planted-foot production
animation. Source contact excursion includes toe roll and capture noise as well
as slide, so it is an upper-bound proxy rather than a force-verified slip measure.

## Foot contacts

Per-foot toe-head standing baselines are medians of the first 60 retained frames;
the lower baseline defines the floor proxy. A contact candidate has toe height
at most baseline + .035 m and centred 12-frame 3D speed below .12 m/s. Only runs
of at least 12 frames are recorded. This is deliberately a kinematic proxy:
it can miss rolling support and cannot distinguish a foot on a stool from floor
support. Excursion is maximum horizontal displacement from the first frame of
each detected contact, measured over approach/turn and rise/departure portions.
The exact tested intervals are in the JSON's `standingTurningContactRanges`.
The floor uncertainty is especially relevant for subject 13's older calibration.

**113_15** — detected contact runs:

- Left: 31–74, 135–800.
- Right: 72–162, 172–220, 238–531, 562–719, 775–800.

**13_05** — detected contact runs:

- Left: 31–114, 199–421, 1249–1450.
- Right: 102–199, 246–259, 264–348, 1249–1360.

**13_01** — detected contact runs:

- Left: 31–71, 152–171, 175–309, 364–548, 557–857, 868–990, 992–1003.
- Right: 31–177, 287–1100.

The first stepstool sit lifts the right foot around 360–390, then the left around
420–480; both remain elevated through much of the seated fidget, and return near
the floor around 1260. Those elevated stationary feet are not floor-locked. The
chair has both feet mostly planted during sitting; foot repositioning near the
rise is retained. The high stool's first sit leaves feet near the floor; its
second, excluded sit has visibly different height traces and must not be treated
as the same contact pattern.

## Reproduction and checks

- `node tools/people/sit-measure.mjs` regenerates the small JSON from the vendored
  data with deterministic FK, contact ranges, seat proxies and drift metrics.
- `node tools/people/sit-measure.mjs --vendor ~/.cache/photonic-scratch/cmu-raw`
  reproduces the exact cuts and both unchanged source skeletons, then measures.
- `node --test test/asf-amc.test.mjs` checks analytical nonzero-axis FK, combined
  rotations, units, invalid data, original frame labels, rig lengths, half-scale
  equivalence and order-independent fractional sampling on all three cuts.
- The standalone lab is copied by `lab/phone-test/assemble.sh` under
  `lab/sit/index.html` and linked from “Waiting for your eye.”

No browser or git was used. Capture selection and quality remain awaiting Kabe's eye.

Validation result: 30 of 31 test files passed in the full parallel run; the existing
keepout test failed there and passed on its isolated rerun. The sitting reader /
retarget tests pass. Assembly passed `check-links` for 98 modules. Vendored files
total **2,523,897 bytes** (2.407 MiB), including both ASF skeletons and NOTICE.

## Part 1b — direction audit and terminal alignment fix

Measured **every retained frame**: 770 in 113_15, 1,420 in 13_05, and
1,070 in 13_01 (3,260 total). This covers all three complete vendored cuts,
not the excluded repetitions in the original recordings. Compare world-space
rig child-minus-head vectors to mapped ASF endpoint-minus-head vectors at the
same sample, with source metres multiplied by the retarget scale. Terminal
segments use the actual procedural head/hand/toe tips transformed by their own
skinning matrices. Root has no source endpoint vector: its direction is N/A.
Full per-capture median/max values are in `quality.directionBefore/After` in
[sit-captures.json](sit-captures.json). Before values were recorded from the
pre-edit workspace; rerunning the tool preserves that historical baseline.

Degrees below are **median / max**; both are equal to the shown precision.
Every after entry is **0.000 / 0.000** (numerical residual below 0.00001°).

| Rig bone → ASF bone | Before 113_15 | Before 13_05 | Before 13_01 |
| --- | --- | --- | --- |
| spine → lowerback | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| chest → thorax | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| neck → lowerneck | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| head → head | 17.881 / 17.881 | 3.649 / 3.649 | 3.649 / 3.649 |
| clavL → lclavicle | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| upperarmL → lhumerus | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| forearmL → lradius | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| handL → lhand | 2.094 / 2.094 | 2.094 / 2.094 | 2.094 / 2.094 |
| clavR → rclavicle | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| upperarmR → rhumerus | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| forearmR → rradius | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| handR → rhand | 2.094 / 2.094 | 2.094 / 2.094 | 2.094 / 2.094 |
| thighL → lfemur | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| shinL → ltibia | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| footL → lfoot | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| toeL → ltoes | 4.523 / 4.523 | 4.519 / 4.519 | 4.519 / 4.519 |
| thighR → rfemur | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| shinR → rtibia | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| footR → rfoot | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 |
| toeR → rtoes | 8.531 / 8.531 | 9.068 / 9.068 | 9.068 / 9.068 |

**Finding:** the reported upper-arm/forearm directional mismatch is not
reproducible from the current files at integer capture samples. Clavicles,
humeri and radii already agree with the source to numerical precision before
this fix, including the stand-up. Consequently no ASF axis or DOF-order change
is justified by this overlay test (both overlay and rig use the same reader).
The reader's nonzero-axis, ordered multi-DOF analytical fixture also passes.
CMU sideways arm rest vectors are already aligned separately to our downward
rest arms; clavicles have their own mapping and rest alignment. Skipped source
ancestors still contribute to source world rotations.

There **was** a terminal rest-alignment bug: head, hand and toe frames inherited
an alignment calculated for a different parent segment vector. Giving each its
own rest-tip alignment removes the constant errors above. The lab now draws
those terminal segments, so the fix is reviewable. The full-frame regression
fails if any mapped segment's median **or maximum** error exceeds 5°; it fails
on the old head and right-toe alignments.

Positional overlay differences must not be mistaken for angular errors.
The procedural rig and the performer have different segment lengths, shoulder
placement and spine/neck segmentation. For example, 113_15's scaled humeri are
about 26.0/27.3 cm, while the rig's are about 29.7 cm. Its radius plus wrist
segments are distinct source bones; the rig uses one forearm. The reader keeps
both in FK. Exact direction transfer does not make their endpoints coincide.
The original report of different forearm slopes remains unverified without the
specific served artifact/sample; no browser or git was used here.

### Foot attribution (same standing/turning contact ranges)

| Capture | Scaled source excursion L / R (cm) | Rig excursion L / R (cm) | Max retarget displacement residual L / R (cm) |
| --- | --- | --- | --- |
| 113_15 | 1.297 / 1.857 | 4.903 / 5.334 | 5.594 / 4.930 |
| 13_05 | 2.060 / 0.975 | 5.900 / 2.483 | 4.382 / 2.095 |
| 13_01 | 2.529 / 2.091 | 2.760 / 4.592 | 2.341 / 3.723 |

The residual is the norm of rig displacement minus scaled source displacement,
relative to each contact interval's first frame, maximized over those intervals;
it is not a subtraction of unrelated excursion maxima. Thus the reported
4.6–5.9 cm **cannot be attributed solely to CMU pivoting**. Source motion is
present, but differing leg proportions, hip offsets and foot lengths introduce
additional movement. The terminal fix does not change toe-head positions and
therefore does not reduce these numbers.

**Unresolved:** the extra foot excursion remains. Exact source directions,
fixed procedural segment lengths, captured root travel and exact source foot
trajectories cannot all be preserved when body proportions differ. This patch
preserves the existing body lengths and raw root motion; it does not silently
replace the rig with the source skeleton or introduce contact cleanup. Removing
this residual requires a proportion change or a positional/contact solve. That
choice was raised with the user; it is not an ASF rotation-order correction.

Validation: `node --test test/asf-amc.test.mjs test/mocap.test.mjs` passes;
`node --check lab/sit/sit.js` passes. Only the permitted task paths were edited.

## Part 1c — independent FK and actual canvas check

The large arm disagreement reported from the reopened lab is **still not
reproduced by these workspace files**. This is not a claim that the observation
was mistaken or that its cause has been fixed. No rest/axis/order correction is
supported by the independent measurements below.

`tools/people/sit-independent.mjs` reparses the ASF/AMC independently of the
retarget instance and recomputes FK with `acclaimFrame`. It accepts only an opaque
pose callback and uses explicit source bone names and rig joint pairs, never
`w.map`, `w.rest`, retarget source matrices, or retarget-aligned vectors. Each
capture segment is its FK endpoint minus head (the child joint minus parent
joint); each rig segment is the difference of its actual `w.pose(n).P` joints.
Both use the lab's fixed seated yaw. Translation and uniform scale cancel in
these direction comparisons. Front/side errors use exactly `(x,-y)` / `(z,-y)`,
the page's orthographic projection. Terminal skinning tips and the directionless
root are excluded from this joint-position audit; the existing terminal audit
remains separate.

Before editing sampling, recorded every integer and quarter frame: **3,077 /
5,677 / 4,277** samples for 113_15 / 13_05 / 13_01. Every bone below has
**0.000 / 0.000 degrees median/max before AND after**, in **world, front and
side**, at matching frame labels, for all three clips (residual < 0.000002°):

| Bone | ASF segment | Before median/max | After median/max |
| --- | --- | --- | --- |
| spine | lowerback | 0.000 / 0.000 | 0.000 / 0.000 |
| chest | thorax | 0.000 / 0.000 | 0.000 / 0.000 |
| neck | lowerneck | 0.000 / 0.000 | 0.000 / 0.000 |
| clavL | lclavicle | 0.000 / 0.000 | 0.000 / 0.000 |
| upperarmL | lhumerus | 0.000 / 0.000 | 0.000 / 0.000 |
| forearmL | lradius | 0.000 / 0.000 | 0.000 / 0.000 |
| clavR | rclavicle | 0.000 / 0.000 | 0.000 / 0.000 |
| upperarmR | rhumerus | 0.000 / 0.000 | 0.000 / 0.000 |
| forearmR | rradius | 0.000 / 0.000 | 0.000 / 0.000 |
| thighL | lfemur | 0.000 / 0.000 | 0.000 / 0.000 |
| shinL | ltibia | 0.000 / 0.000 | 0.000 / 0.000 |
| footL | lfoot | 0.000 / 0.000 | 0.000 / 0.000 |
| thighR | rfemur | 0.000 / 0.000 | 0.000 / 0.000 |
| shinR | rtibia | 0.000 / 0.000 | 0.000 / 0.000 |
| footR | rfoot | 0.000 / 0.000 | 0.000 / 0.000 |

**Confirmed sampling defect, corrected:** autoplay drew the rig at fractional
frame `n` but capture at `round(n)`. Both now use `sampleAcclaim(C,n)`; the
retarget's interpolation is moved unchanged into the reader. The independent
oracle has its own interpolation and never calls this sampler. Before-fix
113_15 errors for the *actual rounded overlay* (degrees median/max) were:

| Arm segment | World | Front | Side |
| --- | --- | --- | --- |
| clavL | .025 / .656 | .011 / .425 | .077 / 1.348 |
| upperarmL | .112 / .792 | .030 / 5.538 | .089 / .795 |
| forearmL | .126 / 1.015 | .043 / 2.904 | .107 / .996 |
| clavR | .024 / .722 | .007 / .658 | .043 / 1.977 |
| upperarmR | .106 / .916 | .033 / 1.308 | .087 / .906 |
| forearmR | .122 / 1.391 | .047 / 1.712 | .095 / 1.145 |

After synchronization all entries are 0.000 / 0.000. The largest 113_15 world
error was only 1.391°, so this sampling defect does **not** explain the reported
roughly 45° upper-arm discrepancy. Projection can amplify small world errors
when a segment points toward the camera (13_05 left forearm front max 33.640°
before synchronization). The original observation's cause remains unresolved;
a different served artifact is a possibility, not an established diagnosis.
Changing the ASF rotation convention would also change the blue overlay and is
not justified as a fix for a disagreement between those two drawings.

`test/sit-independent.test.mjs` checks all those matching samples, and a
negative control reverses the rig's left upper arm: the independent check then
reports 180°, proving it does not compare the rig against itself. A Node-only
DOM/canvas stub executes the actual `lab/sit/sit.js`, advances default autoplay
through six seconds and checks emitted front/side arm lines there and at frames 571,
650.25, 719 and 751.5. It checks the actual drawing calls without a browser.

Reproduce: `node tools/people/sit-independent-measure.mjs` updates only the
independent after measurements, preserving the historical baseline. Full
per-bone/per-view values, including the old rounded-overlay baseline, are in
`quality.independentAudit` in the JSON. The existing measurement tool preserves
this audit. `--baseline` refuses to overwrite an existing baseline.

Validation: `node --test test/sit-independent.test.mjs test/asf-amc.test.mjs
 test/mocap.test.mjs` passes. No browser or git used; left uncommitted. Foot
contact/excursion measurements and the unresolved part-2 question are unchanged.
