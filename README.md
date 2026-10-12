# Photonic phone test

This is a frame-time test for Photonic, the people engine of the holodeck project. Stand-in bodies walk, every one a different shape, in one draw call (three.js r186, WebGPU with a WebGL2 fallback).

Open it at https://5000stadia.github.io/photonic-phone-test/. Settings ride in the hash, for example `#c2c-300-gl-own-near-room`. They are:
- the method;
- the number of people;
- `gl`: WebGL2;
- `own`: each person walks their own fitted gait;
- `near`: one near person with skin and hair;
- `room`: the camera inside a crowded room.

The buttons run the R9 ramp (about 5 minutes) and a ten-minute run.

## Sources and licences

- **Near person's body:** the MakeHuman base mesh, CC0, carrying its clothing layer (`spikes/makehuman/data`).
- **Hair shader:** creategamecharacters/threejs-hair-shader, MIT (`spikes/hair/vendor/LICENSE`, `NOTICE`).
- **Walk basis:** fitted from Van Criekinge et al. 2023 gait data, CC0 (`gait-basis.json`).
- **`traits/`:** the people resolver, there so the page can check that this browser makes the same 200 people as the reference (`golden.sha256`).
- **`people/`:** the people layer (walking, avoiding each other, bumping). The ramp times it on the phone's CPU.
- **Everything else:** written for this test.
