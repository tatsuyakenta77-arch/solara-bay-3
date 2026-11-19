// Meridian Heat — tuning constants and the six-mission story script.
export const CFG = {
  title: 'MERIDIAN HEAT', city: 'Port Meridian',
  pitch: 58, road: 14, blocks: 3, groundSize: 480,
  playerWalk: 7, playerRun: 11, carAccel: 26, carMaxSpeed: 38, carReverseMax: 14,
  carBrake: 40, carTurn: 1.9, trafficSpeed: 9, copSpeed: 31,
  maxHealth: 100, startCash: 250, startAmmo: 60, wantedDecay: 6,
};
export const MISSIONS = [
  { id: 1, name: 'First Gear', pay: 400, brief: 'Mara Quinn needs a driver. Get in the car by the garage and drive to the meet point.',
    steps: [
      { type: 'enterCar', text: 'Get in the car (press E near it)' },
      { type: 'goto', x: 116, z: -116, r: 10, text: 'Drive to the meet point at the north-east corner' },
    ] },
  { id: 2, name: 'The Pickup', pay: 600, brief: 'A package is waiting at the docks. Drive there, get out and collect it on foot.',
    steps: [
      { type: 'goto', x: -20, z: 195, r: 12, text: 'Drive to the docks (south marina)' },
      { type: 'collect', x: -40, z: 218, r: 4, text: 'Get out and collect the package (walk into the marker)' },
    ] },
  { id: 3, name: 'Hot Wheels', pay: 900, brief: 'Mara wants a specific sports car. Steal the yellow coupe in the plaza — the cops will notice.',
    steps: [
      { type: 'steal', x: 29, z: 29, r: 6, text: 'Steal the yellow coupe in the central plaza' },
      { type: 'deliver', x: -116, z: -58, r: 10, text: 'Deliver it to the garage — lose the cops on the way' },
    ] },
  { id: 4, name: 'Dockside Trouble', pay: 1200, brief: "Rival crew The Gulls jumped Mara's people at the docks. Go there and deal with them.",
    steps: [
      { type: 'goto', x: -20, z: 195, r: 12, text: 'Drive to the docks' },
      { type: 'fight', x: -40, z: 218, r: 26, count: 3, text: 'Take out the rival crew (click to shoot, F to punch)' },
    ] },
  { id: 5, name: 'The Getaway', pay: 1500, brief: 'The job went loud. Grab the cash from the bank steps and get to the hideout before the cops box you in.',
    steps: [
      { type: 'collect', x: 116, z: -58, r: 4, text: 'Grab the cash bag at the bank steps' },
      { type: 'deliver', x: 145, z: 116, r: 10, text: "Reach the hideout — wanted level 3, don't get busted" },
    ] },
  { id: 6, name: 'Meridian Heat', pay: 3000, brief: 'One last run. Deliver the money to Mara at the marina while the whole city is after you.',
    steps: [
      { type: 'deliver', x: -29, z: -174, r: 10, text: 'Deliver the money to Mara at the marina — 4 stars, stay moving' },
    ] },
];
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
export function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
