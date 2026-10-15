# CMU Graphics Lab motion capture — sitting study

Original ASF/AMC data, not Hahne/cgspeed BVH conversions. No conversion credit
is claimed or required here. Motion remains under CMU's custom terms; the
repository's code licence does not relicense these files.

Sources (fetched by the project lead directly from CMU; inspected 2026-10-15):

- https://mocap.cs.cmu.edu/subjects/113/113.asf
- https://mocap.cs.cmu.edu/subjects/113/113_15.amc — retained **31–800**
- https://mocap.cs.cmu.edu/subjects/13/13.asf
- https://mocap.cs.cmu.edu/subjects/13/13_05.amc — retained **31–1450**
- https://mocap.cs.cmu.edu/subjects/13/13_01.amc — retained **31–1100**

All ranges are inclusive original AMC frame numbers at 120 Hz. Both calibrated
ASF skeletons are unchanged. AMC changes: trim to one complete sit/rise and
its approach/departure context, replace the local Windows-path header with a
provenance comment, normalize CRLF to LF. Original numeric channel text and
frame numbers are retained. No pose changes or resampling in these assets.
The lab scales by leg length, aligns bone rest directions and translates the
whole sequence to a fixed seat-relative origin. It applies no contact cleanup.

## CMU terms and requested acknowledgment

Source: https://mocap.cs.cmu.edu/ (checked through the indexed CMU page on
2026-10-15; direct page fetch timed out). The homepage states:

> This dataset of motions is free for all uses.

> This data is free for use in research projects.
> You may include this data in commercially-sold products,
> but you may not resell this data directly, even in converted form.
> If you publish results obtained using this data, we would appreciate it
> if you would send the citation to your published paper to jkh+mocap@cs.cmu.edu,
> and also would add this text to your acknowledgments section:

Requested credit, carried here and by the lab's linked notice:

> The data used in this project was obtained from mocap.cs.cmu.edu.
> The database was created with funding from NSF EIA-0196217.

This is free redistribution for review/use in Photonic, not sale of motion data.
The lead checked CMU's redistribution permission before supplying the source
files. FAQ reference: https://mocap.cs.cmu.edu/faqs.php (not re-fetched successfully
in this task). Do not remove the no-direct-resale restriction in downstream copies.
