import { ambToNostr } from '../../src/converters/ambToNostr';
import { nostrToAmb } from '../../src/converters/nostrToAmb';

describe('EKW ext round-trip', () => {
  const resource: any = {
    '@context': ['https://w3id.org/kim/amb/context.jsonld'],
    id: 'https://example.org/material/42',
    type: ['LearningResource'],
    name: 'Schöpfung',
    description: 'Eine Einheit',
    ext: {
      ekw: {
        gradeLevel: [
          { id: 'https://example.org/grade/5', type: 'Concept', prefLabel: { de: 'Klasse 5' } },
          { id: 'https://example.org/grade/6', type: 'Concept', prefLabel: { de: 'Klasse 6' } },
        ],
        bibleReference: ['Gen 1', 'Ps 104'],
      },
      '30168:pub1:reli-form': {
        fach: [{ id: 'https://example.org/fach/reli', type: 'Concept', prefLabel: { de: 'Religion' } }],
      },
    },
  };

  test('ext survives AMB -> Nostr -> AMB', () => {
    const fwd = ambToNostr(resource, { pubkey: 'a'.repeat(64) });
    expect(fwd.success).toBe(true);
    const back = nostrToAmb(fwd.data!);
    expect(back.success).toBe(true);
    const ext = back.data!.ext!;
    expect(ext.ekw.gradeLevel).toEqual(resource.ext.ekw.gradeLevel);
    expect(ext.ekw.bibleReference).toEqual(['Gen 1', 'Ps 104']);
    expect(ext['30168:pub1:reli-form'].fach).toEqual(resource.ext['30168:pub1:reli-form'].fach);
  });
});
