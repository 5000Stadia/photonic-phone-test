import { uv, float } from 'three/tsl';
/** One draw for all visible people; at each person's supplied ground elevation. */
export function makeContactShadow(THREE, capacity) {
  const material = new THREE.MeshBasicNodeMaterial({ color: 0x241b18, transparent: true, depthWrite: false });
  const r = uv().sub(0.5).mul(2).length();
  material.opacityNode = float(1).sub(r.smoothstep(0.1, 1)).pow(2).mul(0.27);
  material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
  const geometry = new THREE.PlaneGeometry(1, 1); geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'people-contact-shadows'; mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 1;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const matrix = new THREE.Matrix4();
  return { mesh, material, begin() { mesh.count = 0; }, add(rec) {
    if (mesh.count >= capacity) return;
    const width = Math.max(0.45, rec.height * 0.38);
    matrix.makeScale(width, 1, width * 0.75); matrix.setPosition(rec.pos[0], rec.pos[1] + 0.008, rec.pos[2]);
    mesh.setMatrixAt(mesh.count++, matrix);
  }, end() { mesh.instanceMatrix.needsUpdate = true; } };
}
