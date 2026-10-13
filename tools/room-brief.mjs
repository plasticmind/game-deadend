#!/usr/bin/env node
// Print what each room needs: its doors (and where they lead), its item, its lock, and
// whether it is a pod room. `node tools/room-brief.mjs 1` for sector 1, or room ids.
import { ROOMS } from '../src/map.js';

const args = process.argv.slice(2).map(Number);
const list = args.length === 1 && args[0] >= 1 && args[0] <= 4
  ? ROOMS.filter((r) => r.zone === args[0])
  : args.length ? args.map((id) => ROOMS[id]) : ROOMS;
for (const r of list) {
  const doors = Object.entries(r.exits).map(([s, to]) => `${s}->${to}`).join(' ');
  const bits = [];
  if (r.item?.kind === 'keyhole') bits.push(`KEYHOLE ${r.item.color} (locks door ${r.lock.side})`);
  else if (r.item) bits.push(`${r.item.kind}${r.item.color ? ' ' + r.item.color : ''}`);
  for (const [s, to] of Object.entries(r.exits)) {
    const l = ROOMS[to].lock;
    if (l && l.to === r.id) bits.push(`door ${s} is locked from the far side (${l.color})`);
  }
  if (r.pod) bits.push('POD ROOM');
  if (r.lair) bits.push("THE SHADOW'S LAIR");
  console.log(`${String(r.id).padStart(3)}  sector ${r.zone}  ${doors.padEnd(24)} ${bits.join('; ')}`);
}
