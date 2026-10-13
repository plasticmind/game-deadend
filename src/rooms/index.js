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
