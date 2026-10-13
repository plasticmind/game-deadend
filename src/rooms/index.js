// Every room's parsed layout, by id. A room nobody has drawn yet gets a placeholder.
import { ROOMS } from '../map.js';
import { parseRoom, placeholderDef } from '../room.js';
import sector1 from './sector1.js';
import sector2 from './sector2.js';
import sector3 from './sector3.js';
import sector4 from './sector4.js';

export const ROOM_DEFS = {};
for (const def of [...sector1, ...sector2, ...sector3, ...sector4]) {
  if (ROOM_DEFS[def.id]) throw new Error(`room ${def.id} is defined twice`);
  ROOM_DEFS[def.id] = def;
}

const cache = new Map();

// The parsed room for an id (parsed once, then shared; treat it as read-only).
export function getRoom(id) {
  let room = cache.get(id);
  if (!room) {
    room = parseRoom(ROOM_DEFS[id] ?? placeholderDef(id), ROOMS[id]);
    cache.set(id, room);
  }
  return room;
}

// Map sections. Every room belongs to the console room nearest it by door hops inside
// its own sector (on a tie, the first one found from the lowest room id). A console room
// is any room with at least one terminal (`T`). Using a console maps its whole section.
// A room with no console room in reach is a section of its own.
let owners = null;
const members = new Map();

function buildSections() {
  owners = new Array(ROOMS.length).fill(-1);
  const hops = new Array(ROOMS.length).fill(Infinity);
  const queue = [];
  for (const m of ROOMS) {
    if (!getRoom(m.id).blocks.some((b) => b.kind === 'terminal')) continue;
    owners[m.id] = m.id;
    hops[m.id] = 0;
    queue.push(m.id);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi];
    for (const to of Object.values(ROOMS[id].exits)) {
      if (to === undefined || to === null || ROOMS[to].zone !== ROOMS[id].zone || hops[to] <= hops[id] + 1) continue;
      hops[to] = hops[id] + 1;
      owners[to] = owners[id];
      queue.push(to);
    }
  }
  for (const m of ROOMS) {
    if (owners[m.id] < 0) owners[m.id] = m.id;
    const list = members.get(owners[m.id]) ?? [];
    list.push(m.id);
    members.set(owners[m.id], list);
  }
}

// The console room whose section holds room `id`.
export function sectionOf(id) {
  if (!owners) buildSections();
  return owners[id];
}

// Every room in the section that console room `owner` maps.
export function sectionRooms(owner) {
  if (!owners) buildSections();
  return members.get(owner) ?? [owner];
}
