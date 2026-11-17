export const chapters = [
  ['broadcast', 'На высоких скоростях!'],
  ['activities', 'Слушай и смотри трансляцию с 09:00 до 12:00 по Мск'],
  ['television', 'Телерадиоэфир'],
  ['archive', 'Архив эфиров'],
  ['circuit-chat', 'Приветы и чат'],
] as const;

export const returnId = 'route-return';
export const cycleLength = chapters.length;

export const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const easeBetween = (from: number, to: number, value: number) => {
  const t = clamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

// Between the content anchors, reserve screen time for the console and the parcel.
const cues = [
  [0, 0], [.10, .02], [.35, .27], [.66, .57], [.85, .79], [1, 1],
  [1.13, 1.04], [1.25, 1.22], [1.42, 2], [1.50, 2.39], [1.58, 3], [1.70, 3.38],
  [1.81, 3.57], [1.93, 3.89], [2, 4],
  [2.085, 4.08], [2.44, 4.95], [2.50, 5],
  [3, 5], [4, 7],
  [4.18, 7.035], [4.37, 7.075], [4.55, 7.18], [4.72, 7.54], [4.93, 7.90], [5, 8],
] as const;

function slope(a: (typeof cues)[number], b: (typeof cues)[number]) {
  return (b[1] - a[1]) / (b[0] - a[0]);
}

function tangent(i: number) {
  if (i === 0 || i === cues.length - 1) return 0;
  const before = slope(cues[i - 1], cues[i]);
  const after = slope(cues[i], cues[i + 1]);
  return before + after === 0 ? 0 : 2 * before * after / (before + after);
}

export function sceneAt(chapter: number, archiveDeparture = 3.75) {
  // Keep the delivery lanes straight until the last archive card has left the
  // viewport. Traffic still uses elapsed time; only the scroll-driven shot holds.
  if (chapter >= 2.5 && chapter <= 4) return 5 + 2 * easeBetween(archiveDeparture, 4, chapter);
  const last = cues.length - 1;
  const index = Math.max(0, Math.min(last - 1, cues.findLastIndex(([at]) => chapter >= at)));
  const [from, a] = cues[index];
  const [to, b] = cues[index + 1];
  const length = to - from;
  const t = clamp((chapter - from) / length);
  return a + (b - a) * t * t * (3 - 2 * t)
    + length * t * (1 - t) * ((1 - t) * tangent(index) - t * tangent(index + 1));
}

export function chapterAt(scroll: number, anchors: readonly number[]) {
  const index = Math.max(0, Math.min(anchors.length - 2, anchors.findLastIndex(mark => scroll >= mark)));
  return index + clamp((scroll - anchors[index]) / Math.max(1, anchors[index + 1] - anchors[index]));
}

export function wrapScroll(offset: number, end: number) {
  const turns = Math.floor(offset / end);
  return { turns, top: offset - turns * end };
}

export function cycleChapter(progress: number, atEnd: boolean) {
  const chapter = progress - Math.floor(progress / cycleLength) * cycleLength;
  return chapter === 0 && atEnd ? cycleLength : chapter;
}
