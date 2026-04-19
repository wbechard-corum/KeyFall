function buildMidiNotes(noteData, bpm, track) {
  const beatDur = 60 / bpm;
  const notes = [];
  let time = 0.5;
  for (const [midi, beats] of noteData) {
    if (midi > 0) {
      notes.push({
        midi,
        startTime: time,
        endTime: time + beats * beatDur * 0.9,
        velocity: 80,
        track: track || 0,
        played: false,
        hit: false,
      });
    }
    time += beats * beatDur;
  }
  return notes;
}

function combine(name, tracks, bpm) {
  const notes = tracks.flatMap(({ data, track }) => buildMidiNotes(data, bpm, track));
  notes.sort((a, b) => a.startTime - b.startTime);
  const duration = notes.length > 0 ? Math.max(...notes.map(n => n.endTime)) : 0;
  return { notes, duration, name, tracks: tracks.length };
}

export const DEMOS = {
  twinkle: {
    label: 'Twinkle Twinkle',
    difficulty: 'BEGINNER',
    build: () => combine('Twinkle Twinkle Little Star', [
      {
        track: 0,
        data: [
          [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
          [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
          [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
          [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
          [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
          [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
        ],
      },
      {
        track: 1,
        data: [
          [48, 2], [48, 2], [48, 2], [48, 2],
          [41, 2], [41, 2], [43, 2], [48, 2],
          [43, 2], [41, 2], [40, 2], [43, 2],
          [43, 2], [41, 2], [40, 2], [43, 2],
          [48, 2], [48, 2], [48, 2], [48, 2],
          [41, 2], [41, 2], [43, 2], [48, 2],
        ],
      },
    ], 100),
  },
  ode: {
    label: 'Ode to Joy',
    difficulty: 'BEGINNER',
    build: () => combine('Ode to Joy', [
      {
        track: 0,
        data: [
          [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
          [60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2],
          [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
          [60, 1], [60, 1], [62, 1], [64, 1], [62, 1.5], [60, 0.5], [60, 2],
        ],
      },
      {
        track: 1,
        data: [
          [48, 2], [48, 2], [48, 2], [48, 2],
          [48, 2], [43, 2], [48, 2], [43, 2],
          [48, 2], [48, 2], [48, 2], [48, 2],
          [48, 2], [43, 2], [48, 4],
        ],
      },
    ], 108),
  },
  scale: {
    label: 'C Major Scale',
    difficulty: 'EXERCISE',
    build: () => {
      const up = [60, 62, 64, 65, 67, 69, 71, 72].map(n => [n, 1]);
      const down = [72, 71, 69, 67, 65, 64, 62, 60].map(n => [n, 1]);
      return combine('C Major Scale', [{ track: 0, data: [...up, ...down] }], 90);
    },
  },
  minuet: {
    label: 'Minuet in G',
    difficulty: 'INTERMEDIATE',
    build: () => combine('Minuet in G (simplified)', [
      {
        track: 0,
        data: [
          [67, 2], [66, 1], [67, 1], [69, 1], [71, 1],
          [72, 2], [67, 1], [67, 1], [0, 1], [0, 1],
          [72, 2], [74, 1], [72, 1], [71, 1], [69, 1],
          [71, 2], [67, 1], [67, 1], [0, 1], [0, 1],
          [69, 2], [71, 1], [69, 1], [67, 1], [66, 1],
          [67, 2], [64, 1], [62, 1], [64, 1], [67, 1],
          [69, 1], [67, 1], [66, 1], [64, 1], [66, 1], [67, 1],
          [66, 3], [0, 3],
        ],
      },
      {
        track: 1,
        data: [
          [55, 3], [55, 3], [60, 3], [60, 3],
          [59, 3], [59, 3], [55, 3], [55, 3],
          [57, 3], [57, 3], [55, 3], [52, 3],
          [57, 3], [57, 3], [55, 3], [0, 3],
        ],
      },
    ], 110),
  },
};
