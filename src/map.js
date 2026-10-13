// The lair: 128 rooms in four sectors, transcribed from the hand-drawn Shamus map
// (reference/shamus-map.png). Every connection is a door on one side of a room; the
// room on the other end uses the opposite side. Dotted connections on the map are
// locked doors, opened from the keyhole room with a key of the matching color.
//
// gx and gy are the room's cell on that map. The pause screen draws the map from them;
// they say nothing about which side a door is on (the lair is not Euclidean).

export const START_ROOM = 0;
export const LAIR_ROOM = 127;

export const SIDES = ['N', 'E', 'S', 'W'];
export const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

// Sector 1 is the original's BLACK level, then BLUE, GREEN, and RED.
export const ZONES = [
  null,
  { id: 1, name: 'Black Sector', short: 'BLACK', color: '#8f7bff' },
  { id: 2, name: 'Blue Sector', short: 'BLUE', color: '#3fa9ff' },
  { id: 3, name: 'Green Sector', short: 'GREEN', color: '#3ee07a' },
  { id: 4, name: 'Red Sector', short: 'RED', color: '#ff4d3d' },
];

export const KEY_COLORS = {
  blue: { name: 'Blue', hex: '#3d8bff' },
  green: { name: 'Green', hex: '#33dd66' },
  brown: { name: 'Bronze', hex: '#c8843a' },
  purple: { name: 'Purple', hex: '#b45cff' },
  cyan: { name: 'Cyan', hex: '#2fe6f0' },
};

// [room, side, room, lockColor?]. A lock sits on the first room's door: that room holds
// the keyhole, and the player always reaches it from that side first.
const EDGES = [
  // Sector 1 (Black)
  [0, 'E', 1], [1, 'E', 2], [2, 'E', 3], [3, 'N', 4], [4, 'E', 5], [5, 'E', 6], [6, 'E', 7],
  [7, 'S', 36], [1, 'S', 8], [8, 'E', 9], [9, 'E', 10], [10, 'E', 11], [11, 'E', 12],
  [12, 'S', 25], [10, 'S', 16], [16, 'W', 15], [15, 'W', 14, 'blue'], [14, 'W', 13],
  [14, 'S', 21], [13, 'S', 19], [22, 'S', 17], [17, 'E', 18], [18, 'E', 19], [19, 'E', 20],
  [20, 'E', 21], [23, 'E', 24], [23, 'S', 30], [24, 'E', 25], [25, 'E', 26], [26, 'E', 27],
  [27, 'N', 35], [35, 'E', 36], [36, 'E', 37], [27, 'E', 28], [28, 'E', 29], [29, 'S', 34],
  [30, 'E', 31], [31, 'E', 32], [32, 'E', 33], [33, 'E', 34],
  [37, 'E', 38, 'green'],
  // Sector 2 (Blue)
  [38, 'E', 39], [39, 'E', 40], [40, 'E', 41, 'purple'], [41, 'N', 43], [41, 'E', 42],
  [43, 'E', 44], [44, 'E', 45], [45, 'S', 42], [39, 'S', 48], [48, 'W', 47],
  [47, 'W', 46, 'brown'], [46, 'S', 50], [49, 'E', 50], [49, 'S', 57], [50, 'E', 51],
  [51, 'E', 52], [52, 'S', 59], [52, 'E', 53], [53, 'E', 54], [54, 'S', 62], [54, 'E', 55],
  [57, 'E', 58], [58, 'E', 59], [60, 'E', 61], [60, 'S', 65], [61, 'E', 62], [62, 'E', 63],
  [63, 'E', 64], [64, 'S', 66], [65, 'E', 66],
  [55, 'E', 56, 'green'],
  // Sector 3 (Green)
  [56, 'S', 67], [67, 'E', 68], [68, 'E', 69], [69, 'E', 70], [70, 'E', 71], [71, 'E', 72],
  [71, 'S', 77], [72, 'S', 78], [73, 'E', 74], [73, 'S', 83], [74, 'E', 75], [75, 'E', 76],
  [76, 'E', 77], [78, 'E', 79], [79, 'E', 80], [80, 'E', 81], [81, 'E', 82], [82, 'S', 85],
  [83, 'E', 84], [84, 'E', 85], [84, 'S', 89], [88, 'E', 89], [88, 'S', 86], [89, 'E', 90],
  [90, 'E', 91], [91, 'E', 92], [91, 'S', 87], [86, 'E', 87],
  [92, 'E', 93, 'green'],
  // Sector 4 (Red). 114-117 crosses 93-94 on the map without meeting it.
  [93, 'E', 94], [114, 'S', 117], [114, 'E', 115], [115, 'E', 116], [116, 'S', 94],
  [94, 'E', 95], [95, 'E', 96], [95, 'S', 122], [96, 'E', 97], [97, 'E', 98],
  [98, 'E', 99, 'blue'], [97, 'S', 107], [100, 'N', 105], [105, 'E', 106], [106, 'S', 104],
  [100, 'E', 101], [101, 'E', 102], [102, 'E', 103], [103, 'E', 104], [102, 'S', 99],
  [107, 'E', 108], [108, 'E', 109, 'green'], [109, 'E', 110], [110, 'E', 111], [111, 'S', 113],
  [109, 'S', 112], [112, 'E', 113], [117, 'E', 118], [118, 'E', 119], [119, 'N', 120],
  [120, 'E', 121], [121, 'E', 122], [122, 'E', 123], [123, 'E', 124, 'cyan'], [124, 'S', 125],
  [125, 'E', 126], [126, 'E', 127],
];

// Map positions, [gx, gy] by room id.
const POS = [
  [3, 1], [4, 1], [5, 1], [6, 1], [6, 0], [7, 0], [8, 0], [12, 0], [4, 2], [5, 2], // 0-9
  [6, 2], [8, 2], [9, 2], [2, 3], [4, 3], [5, 3], [6, 3], [0, 4], [1, 4], [2, 4], // 10-19
  [3, 4], [4, 4], [0, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [12, 3], [13, 3], // 20-29
  [7, 4], [9, 4], [10, 4], [11, 4], [13, 4], [11, 2], [12, 2], [13, 2], [17, 2], [18, 2], // 30-39
  [19, 2], [20, 2], [22, 2], [20, 1], [21, 1], [22, 1], [16, 3], [17, 3], [18, 3], [15, 4], // 40-49
  [16, 4], [17, 4], [18, 4], [19, 4], [20, 4], [22, 4], [24, 4], [15, 5], [16, 5], [18, 5], // 50-59
  [18, 6], [19, 6], [20, 6], [21, 6], [22, 6], [18, 7], [22, 7], [24, 6], [25, 6], [26, 6], // 60-69
  [27, 6], [29, 6], [30, 6], [25, 7], [26, 7], [27, 7], [28, 7], [29, 7], [30, 7], [31, 7], // 70-79
  [32, 7], [33, 7], [34, 7], [25, 8], [26, 8], [34, 8], [25, 10], [28, 10], [25, 9], [26, 9], // 80-89
  [27, 9], [28, 9], [29, 9], [36, 9], [39, 9], [41, 9], [42, 9], [44, 9], [45, 9], [46, 9], // 90-99
  [44, 8], [45, 8], [46, 8], [47, 8], [48, 8], [44, 7], [48, 7], [44, 10], [45, 10], [46, 10], // 100-109
  [47, 10], [48, 10], [46, 11], [48, 11], [37, 8], [38, 8], [39, 8], [37, 11], [38, 11], [39, 11], // 110-119
  [39, 10], [40, 10], [41, 10], [42, 10], [43, 10], [43, 11], [44, 11], [45, 11], // 120-127
];

const MYSTERY = [0, 9, 11, 24, 26, 31, 51, 61, 68, 70, 75, 80, 90, 93, 115, 121, 126];
const LIFE = [5, 6, 20, 28, 33, 38, 58, 63, 69, 74, 76, 81, 96, 101];
const KEYS = { 2: 'blue', 18: 'green', 32: 'brown', 44: 'green', 53: 'purple', 79: 'green', 103: 'green', 110: 'cyan', 118: 'blue' };

// Pod rooms "exist in another dimension": a timed gate guards one of their doors.
export const POD_ROOMS = [6, 20, 33, 58, 63, 74, 81, 101];

function zoneOf(id) {
  if (id <= 37) return 1;
  if (id === 56 || (id >= 67 && id <= 92)) return 3;
  if (id <= 66) return 2;
  return 4;
}

export const ROOMS = [];
for (let id = 0; id < 128; id++) {
  const [gx, gy] = POS[id];
  ROOMS.push({ id, zone: zoneOf(id), gx, gy, exits: {}, item: null, lock: null, pod: POD_ROOMS.includes(id) });
}

// lockId is the keyhole room's id; locks open for good once a key is used on them.
export const LOCKS = [];
for (const [a, side, b, color] of EDGES) {
  const back = OPPOSITE[side];
  if (ROOMS[a].exits[side] !== undefined || ROOMS[b].exits[back] !== undefined) {
    throw new Error(`map: door ${a}${side} or ${b}${back} is used twice`);
  }
  ROOMS[a].exits[side] = b;
  ROOMS[b].exits[back] = a;
  if (color) {
    const lock = { id: a, room: a, side, to: b, color };
    LOCKS.push(lock);
    ROOMS[a].lock = lock;
    ROOMS[a].item = { kind: 'keyhole', color };
  }
}
for (const id of MYSTERY) ROOMS[id].item = { kind: 'mystery' };
for (const id of LIFE) ROOMS[id].item = { kind: 'life' };
for (const [id, color] of Object.entries(KEYS)) ROOMS[id].item = { kind: 'key', color };
ROOMS[LAIR_ROOM].lair = true;

// The lock (if any) on the door between room `id` and its `side` neighbor, seen from
// either room.
export function lockOn(id, side) {
  const own = ROOMS[id].lock;
  if (own && own.side === side) return own;
  const other = ROOMS[id].exits[side];
  if (other === undefined) return null;
  const theirs = ROOMS[other].lock;
  return theirs && theirs.side === OPPOSITE[side] ? theirs : null;
}
